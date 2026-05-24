"""
Buffer API Poster

Posts formatted videos to social media via Buffer's GraphQL API.
Creates engaging French captions with travel hashtags.
Schedules posts with spacing to avoid spam.
"""

import json
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import config

logger = logging.getLogger(__name__)


def load_post_log() -> list[dict]:
    """Load the post history log."""
    if config.POST_LOG_FILE.exists():
        try:
            with open(config.POST_LOG_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            logger.warning("Corrupted post_log.json, starting fresh")
    return []


def save_post_log(log: list[dict]) -> None:
    """Append to the post history log."""
    with open(config.POST_LOG_FILE, "w") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)


def generate_caption(video_info: dict) -> str:
    """
    Generate an engaging French caption with relevant hashtags.
    Uses templates from config and mixes in the video's original hashtags.
    """
    # Pick a random caption template
    template = random.choice(config.CAPTION_TEMPLATES)

    # Build hashtag string from video's original tags + our base hashtags
    source_hashtags = video_info.get("hashtags", [])
    hashtag_strs = []

    for tag in source_hashtags:
        tag_clean = tag.strip().lstrip("#")
        if tag_clean and f"#{tag_clean}" not in config.BASE_HASHTAGS:
            hashtag_strs.append(f"#{tag_clean}")

    # Limit to 5-8 source hashtags to keep it clean
    if len(hashtag_strs) > 8:
        hashtag_strs = random.sample(hashtag_strs, 8)

    all_hashtags = " ".join(hashtag_strs)

    caption = template.format(hashtags=all_hashtags)

    return caption.strip()


def upload_video_to_buffer(file_path: str) -> str | None:
    """
    Upload a video file to Buffer's media endpoint.
    Buffer requires videos to be uploaded first, then referenced in the post.

    Returns the media URL/ID on success, None on failure.
    """
    if not config.BUFFER_TOKEN:
        logger.error("BUFFER_TOKEN not set")
        return None

    # Buffer uses a media upload endpoint
    upload_url = "https://api.buffer.com/rpc/composerApiProxy"

    headers = {
        "Authorization": f"Bearer {config.BUFFER_TOKEN}",
    }

    # Try direct file upload approach
    # Buffer's video upload uses multipart form data
    try:
        with open(file_path, "rb") as f:
            file_size = Path(file_path).stat().st_size
            logger.info("Uploading video to Buffer: %s (%d bytes)", Path(file_path).name, file_size)

            # Buffer upload via their upload endpoint
            upload_resp = requests.post(
                "https://upload.buffer.com/upload",
                headers={"Authorization": f"Bearer {config.BUFFER_TOKEN}"},
                files={"file": (Path(file_path).name, f, "video/mp4")},
                timeout=120,
            )

            if upload_resp.status_code == 200:
                data = upload_resp.json()
                upload_url = data.get("url") or data.get("uploaded_url") or data.get("location")
                if upload_url:
                    logger.info("Video uploaded to Buffer: %s", upload_url)
                    return upload_url
                # Some responses embed differently
                logger.info("Upload response: %s", json.dumps(data)[:500])
                return data.get("key") or data.get("id") or json.dumps(data)
            else:
                logger.error(
                    "Buffer upload failed (%d): %s",
                    upload_resp.status_code, upload_resp.text[:500],
                )
                return None

    except requests.RequestException as e:
        logger.error("Failed to upload video to Buffer: %s", e)
        return None


def create_buffer_post(
    channel_id: str,
    channel_name: str,
    platform: str,
    caption: str,
    media_url: str | None = None,
    schedule_mode: str = "shareNow",
    scheduled_at: str | None = None,
    dry_run: bool = False,
) -> dict | None:
    """
    Create a post on Buffer using their GraphQL API.

    Args:
        channel_id: Buffer channel ID
        channel_name: Channel display name
        platform: Platform name (tiktok, instagram, youtube)
        caption: Post caption text
        media_url: URL of uploaded video
        schedule_mode: "shareNow", "addToQueue", or "customScheduled"
        scheduled_at: ISO timestamp for customScheduled mode
        dry_run: If True, log but don't actually post

    Returns:
        API response dict on success, None on failure.
    """
    if dry_run:
        logger.info(
            "[DRY RUN] Would post to %s (%s): %s...",
            platform, channel_name, caption[:80],
        )
        return {
            "dry_run": True,
            "platform": platform,
            "channel": channel_name,
            "caption": caption[:80],
            "mode": schedule_mode,
        }

    if not config.BUFFER_TOKEN:
        logger.error("BUFFER_TOKEN not set - cannot post")
        return None

    headers = {
        "Authorization": f"Bearer {config.BUFFER_TOKEN}",
        "Content-Type": "application/json",
        "X-Buffer-Client-Id": "auto-repost",
    }

    # Build assets based on whether we have video
    assets = {}
    if media_url:
        assets["video"] = {"url": media_url}

    # Build the scheduling input
    scheduling = {"type": schedule_mode}
    if schedule_mode == "customScheduled" and scheduled_at:
        scheduling["customScheduleTime"] = scheduled_at

    # Channel-specific settings
    channel_config = config.BUFFER_CHANNELS.get(platform, {})
    scheduling_type = channel_config.get("scheduling_type", "automatic")

    # For TikTok, always use "automatic" scheduling type (direct post, not notification)
    channel_settings = {}
    if platform == "tiktok":
        channel_settings["schedulingType"] = scheduling_type

    # GraphQL mutation for creating a post
    mutation = """
    mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
            ... on PostActionSuccess {
                post {
                    id
                    status
                    text
                }
            }
            ... on PostActionError {
                message
            }
        }
    }
    """

    variables = {
        "input": {
            "organizationId": config.BUFFER_ORG_ID,
            "channelIds": [channel_id],
            "text": caption,
            "assets": assets,
            "scheduling": scheduling,
        }
    }

    # Add channel-specific settings if any
    if channel_settings:
        variables["input"]["channelSettings"] = {
            channel_id: channel_settings
        }

    payload = {
        "operationName": "CreatePost",
        "query": mutation,
        "variables": variables,
    }

    logger.info("Posting to %s (%s) via Buffer GraphQL API", platform, channel_name)
    logger.debug("Payload: %s", json.dumps(payload, indent=2)[:1000])

    try:
        resp = requests.post(
            config.BUFFER_API_URL,
            headers=headers,
            json=payload,
            timeout=60,
        )

        if resp.status_code == 200:
            data = resp.json()
            result = data.get("data", {}).get("createPost", {})

            if "post" in result:
                post_id = result["post"].get("id", "unknown")
                logger.info(
                    "Successfully posted to %s: post_id=%s, status=%s",
                    platform, post_id, result["post"].get("status"),
                )
                return result
            elif "message" in result:
                logger.error("Buffer API error for %s: %s", platform, result["message"])
                return None
            else:
                logger.warning("Unexpected response for %s: %s", platform, json.dumps(data)[:500])
                return data
        else:
            logger.error(
                "Buffer API request failed (%d): %s",
                resp.status_code, resp.text[:500],
            )
            return None

    except requests.RequestException as e:
        logger.error("Request error posting to %s: %s", platform, e)
        return None


def post_video(video_info: dict, dry_run: bool = False) -> list[dict]:
    """
    Post a formatted video to all enabled Buffer channels.
    Spaces out posts to avoid spam.

    Args:
        video_info: Dict with formatted_paths, id, title, hashtags, etc.
        dry_run: If True, log actions but don't actually post.

    Returns:
        List of post result dicts.
    """
    formatted_paths = video_info.get("formatted_paths", {})
    if not formatted_paths:
        logger.warning("No formatted videos for %s", video_info.get("id"))
        return []

    caption = generate_caption(video_info)
    logger.info("Generated caption: %s", caption[:100])

    post_results = []
    post_log = load_post_log()
    is_first = True
    scheduled_time = datetime.now(timezone.utc)

    for platform, file_path in formatted_paths.items():
        channel = config.BUFFER_CHANNELS.get(platform)
        if not channel or not channel.get("enabled"):
            logger.debug("Skipping disabled channel: %s", platform)
            continue

        # Upload video to Buffer (unless dry run)
        media_url = None
        if not dry_run:
            media_url = upload_video_to_buffer(file_path)
            if not media_url:
                logger.error("Failed to upload video for %s, skipping", platform)
                continue

        # First post goes out now, subsequent ones are queued with spacing
        if is_first and config.FIRST_POST_IMMEDIATE:
            mode = "shareNow"
            is_first = False
        else:
            mode = "addToQueue"
            is_first = False

        result = create_buffer_post(
            channel_id=channel["id"],
            channel_name=channel["name"],
            platform=platform,
            caption=caption,
            media_url=media_url,
            schedule_mode=mode,
            dry_run=dry_run,
        )

        post_entry = {
            "video_id": video_info.get("id"),
            "platform": platform,
            "channel_name": channel["name"],
            "caption": caption,
            "file_path": file_path,
            "mode": mode,
            "success": result is not None,
            "result": result,
            "posted_at": datetime.now(timezone.utc).isoformat(),
        }
        post_results.append(post_entry)
        post_log.append(post_entry)

        # Small delay between platform posts
        if not dry_run:
            time.sleep(5)

    save_post_log(post_log)
    return post_results


def post_all_videos(videos: list[dict], dry_run: bool = False) -> list[dict]:
    """
    Post all formatted videos to Buffer with appropriate spacing.

    Args:
        videos: List of video info dicts with formatted_paths.
        dry_run: If True, log actions but don't post.

    Returns:
        List of all post results.
    """
    all_results = []

    for i, video_info in enumerate(videos):
        logger.info(
            "Posting video %d/%d: %s",
            i + 1, len(videos), video_info.get("id"),
        )

        results = post_video(video_info, dry_run=dry_run)
        all_results.extend(results)

        successes = sum(1 for r in results if r.get("success"))
        logger.info(
            "Video %s: %d/%d platforms posted successfully",
            video_info.get("id"), successes, len(results),
        )

        # Space out between different videos
        if i < len(videos) - 1 and not dry_run:
            logger.info(
                "Waiting %d minutes before next video...",
                config.POST_SPACING_MINUTES,
            )
            time.sleep(config.POST_SPACING_MINUTES * 60)

    total_success = sum(1 for r in all_results if r.get("success"))
    logger.info(
        "Posting complete: %d/%d posts successful",
        total_success, len(all_results),
    )

    return all_results


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print("Poster module loaded. Use main.py to run the full pipeline.")
    print(f"Buffer token configured: {'Yes' if config.BUFFER_TOKEN else 'No'}")
    print(f"Enabled channels: {[n for n, c in config.BUFFER_CHANNELS.items() if c.get('enabled')]}")
