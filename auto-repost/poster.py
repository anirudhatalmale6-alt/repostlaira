"""
Social Media Video Poster

Posts formatted videos to social media via direct platform APIs (primary)
with Buffer GraphQL API as fallback.

Supported platforms:
  - TikTok: Content Posting API v2
  - YouTube: Data API v3 (Shorts)
  - Instagram: Graph API (Reels)
  - Buffer: GraphQL API (fallback for all platforms)

Creates engaging French captions with travel hashtags.
Schedules posts with spacing to avoid spam.
"""

import json
import logging
import os
import random
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import config

RATE_LIMIT_FILE = config.BASE_DIR / "rate_limit_until.txt"

logger = logging.getLogger(__name__)

# ─── Direct Platform API Configuration ──────────────────────────────────────

# TikTok Content Posting API
TIKTOK_ACCESS_TOKEN = os.getenv("TIKTOK_ACCESS_TOKEN", "")
TIKTOK_CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "aw1j8mw20p6ovj1s")
TIKTOK_CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "u7emxMzPl1v0Uzct3tvukMiiNc7jaVLf")
TIKTOK_API_BASE = "https://open.tiktokapis.com/v2"

# YouTube Data API v3
YOUTUBE_REFRESH_TOKEN = os.getenv("YOUTUBE_REFRESH_TOKEN", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Instagram Graph API (via Facebook)
INSTAGRAM_ACCESS_TOKEN = os.getenv("INSTAGRAM_ACCESS_TOKEN", "")
INSTAGRAM_BUSINESS_ID = os.getenv("INSTAGRAM_BUSINESS_ID", "")
INSTAGRAM_GRAPH_URL = "https://graph.facebook.com/v19.0"


def check_rate_limit() -> bool:
    """Return True if we're currently rate-limited."""
    if RATE_LIMIT_FILE.exists():
        try:
            until = datetime.fromisoformat(RATE_LIMIT_FILE.read_text().strip())
            if datetime.now(timezone.utc) < until:
                logger.warning("Rate-limited until %s (in %d seconds)", until.isoformat(), (until - datetime.now(timezone.utc)).total_seconds())
                return True
            RATE_LIMIT_FILE.unlink(missing_ok=True)
        except (ValueError, OSError):
            RATE_LIMIT_FILE.unlink(missing_ok=True)
    return False


def save_rate_limit(retry_after: int) -> None:
    """Save rate limit expiry so future runs skip the API."""
    until = datetime.now(timezone.utc) + timedelta(seconds=retry_after)
    RATE_LIMIT_FILE.write_text(until.isoformat())
    logger.info("Rate limit saved: retry after %d seconds (until %s)", retry_after, until.isoformat())


def handle_rate_limit_response(resp: requests.Response) -> bool:
    """Check for 429 response and save rate limit info. Returns True if rate-limited."""
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("retry-after", 3600))
        save_rate_limit(retry_after)
        return True
    return False


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


###############################################################################
# Direct Platform API Posting Methods
###############################################################################


def post_tiktok_direct(video_path: str, caption: str) -> dict | None:
    """
    Post a video directly to TikTok using the Content Posting API v2.

    Flow:
      1. Initialize video upload via POST /v2/post/publish/inbox/video/init/
      2. Upload video file via the returned upload URL
      3. TikTok processes and publishes to the creator's inbox

    The video lands in the creator's TikTok inbox for final review/publish.

    Returns:
        Result dict on success, None on failure.
    """
    if not TIKTOK_ACCESS_TOKEN:
        logger.warning("TIKTOK_ACCESS_TOKEN not set, cannot post directly to TikTok")
        return None

    file_size = Path(video_path).stat().st_size
    logger.info("[TikTok Direct] Initiating video upload (%d bytes)", file_size)

    headers = {
        "Authorization": f"Bearer {TIKTOK_ACCESS_TOKEN}",
        "Content-Type": "application/json; charset=UTF-8",
    }

    # Step 1: Initialize the upload
    init_url = f"{TIKTOK_API_BASE}/post/publish/inbox/video/init/"
    init_body = {
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": file_size,
            "chunk_size": file_size,  # Single chunk upload
            "total_chunk_count": 1,
        },
    }

    try:
        resp = requests.post(init_url, headers=headers, json=init_body, timeout=30)

        if resp.status_code != 200:
            logger.error(
                "[TikTok Direct] Init failed (%d): %s",
                resp.status_code, resp.text[:500],
            )
            return None

        init_data = resp.json()
        error_data = init_data.get("error", {})
        if error_data.get("code") != "ok" and error_data.get("code") is not None:
            logger.error(
                "[TikTok Direct] Init error: %s - %s",
                error_data.get("code"), error_data.get("message"),
            )
            return None

        data = init_data.get("data", {})
        upload_url = data.get("upload_url")
        publish_id = data.get("publish_id")

        if not upload_url:
            logger.error("[TikTok Direct] No upload_url in response: %s", json.dumps(init_data)[:500])
            return None

        logger.info("[TikTok Direct] Got upload URL, publish_id=%s", publish_id)

        # Step 2: Upload the video file
        with open(video_path, "rb") as f:
            video_data = f.read()

        upload_headers = {
            "Content-Range": f"bytes 0-{file_size - 1}/{file_size}",
            "Content-Type": "video/mp4",
        }

        upload_resp = requests.put(
            upload_url,
            data=video_data,
            headers=upload_headers,
            timeout=120,
        )

        if upload_resp.status_code not in (200, 201, 204):
            logger.error(
                "[TikTok Direct] Upload failed (%d): %s",
                upload_resp.status_code, upload_resp.text[:300],
            )
            return None

        logger.info(
            "[TikTok Direct] Video uploaded successfully! publish_id=%s. "
            "Video will appear in creator's TikTok inbox for review.",
            publish_id,
        )

        return {
            "platform": "tiktok",
            "method": "direct_api",
            "publish_id": publish_id,
            "status": "uploaded_to_inbox",
        }

    except requests.RequestException as e:
        logger.error("[TikTok Direct] Request error: %s", e)
        return None


def _get_youtube_access_token() -> str | None:
    """
    Exchange the YouTube refresh token for a fresh access token
    using Google OAuth2 token endpoint.
    """
    if not all([YOUTUBE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET]):
        return None

    try:
        resp = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": YOUTUBE_REFRESH_TOKEN,
                "grant_type": "refresh_token",
            },
            timeout=15,
        )

        if resp.status_code == 200:
            token_data = resp.json()
            access_token = token_data.get("access_token")
            if access_token:
                logger.debug("[YouTube Direct] Got fresh access token")
                return access_token

        logger.error(
            "[YouTube Direct] Token refresh failed (%d): %s",
            resp.status_code, resp.text[:300],
        )
        return None

    except requests.RequestException as e:
        logger.error("[YouTube Direct] Token refresh error: %s", e)
        return None


def post_youtube_direct(video_path: str, caption: str) -> dict | None:
    """
    Upload a video as a YouTube Short using the YouTube Data API v3.

    Uses resumable upload protocol:
      1. Get fresh access token via refresh token
      2. Initiate resumable upload with video metadata
      3. Upload the video file
      4. Video is published as a YouTube Short (vertical, < 60s)

    Returns:
        Result dict on success, None on failure.
    """
    access_token = _get_youtube_access_token()
    if not access_token:
        logger.warning("[YouTube Direct] Cannot get access token, skipping direct upload")
        return None

    file_size = Path(video_path).stat().st_size
    logger.info("[YouTube Direct] Uploading video as Short (%d bytes)", file_size)

    # Extract title from caption (first line, max 100 chars)
    title_line = caption.split("\n")[0].strip()
    if len(title_line) > 100:
        title_line = title_line[:97] + "..."

    # Append #Shorts tag to ensure YouTube recognizes it as a Short
    description = caption
    if "#Shorts" not in caption and "#shorts" not in caption:
        description = caption + "\n\n#Shorts"

    # Video metadata
    metadata = {
        "snippet": {
            "title": title_line,
            "description": description,
            "tags": ["ArialTravel", "Travel", "Shorts", "Voyage", "LuxuryTravel"],
            "categoryId": "19",  # Travel & Events
        },
        "status": {
            "privacyStatus": "public",
            "selfDeclaredMadeForKids": False,
            "shortDescription": title_line,
        },
    }

    # Step 1: Initiate resumable upload
    init_headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": str(file_size),
    }

    try:
        init_resp = requests.post(
            f"{YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status",
            headers=init_headers,
            json=metadata,
            timeout=30,
        )

        if init_resp.status_code != 200:
            logger.error(
                "[YouTube Direct] Init failed (%d): %s",
                init_resp.status_code, init_resp.text[:500],
            )
            return None

        upload_url = init_resp.headers.get("Location")
        if not upload_url:
            logger.error("[YouTube Direct] No Location header in init response")
            return None

        logger.info("[YouTube Direct] Got resumable upload URL")

        # Step 2: Upload the video file
        with open(video_path, "rb") as f:
            upload_resp = requests.put(
                upload_url,
                data=f,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "video/mp4",
                    "Content-Length": str(file_size),
                },
                timeout=300,  # Large file upload timeout
            )

        if upload_resp.status_code in (200, 201):
            video_data = upload_resp.json()
            video_id = video_data.get("id", "unknown")
            logger.info(
                "[YouTube Direct] Video uploaded successfully! video_id=%s, URL=https://youtube.com/shorts/%s",
                video_id, video_id,
            )
            return {
                "platform": "youtube",
                "method": "direct_api",
                "video_id": video_id,
                "url": f"https://youtube.com/shorts/{video_id}",
                "status": "published",
            }
        else:
            logger.error(
                "[YouTube Direct] Upload failed (%d): %s",
                upload_resp.status_code, upload_resp.text[:500],
            )
            return None

    except requests.RequestException as e:
        logger.error("[YouTube Direct] Request error: %s", e)
        return None


def post_instagram_direct(video_path: str, caption: str) -> dict | None:
    """
    Post a video as an Instagram Reel using the Instagram Graph API.

    Flow:
      1. Upload video to a publicly accessible URL (local server fallback)
      2. Create a media container with the video URL
      3. Poll for container status until ready
      4. Publish the container

    Returns:
        Result dict on success, None on failure.
    """
    if not INSTAGRAM_ACCESS_TOKEN or not INSTAGRAM_BUSINESS_ID:
        logger.warning("[Instagram Direct] Missing access token or business ID")
        return None

    logger.info("[Instagram Direct] Posting Reel to account %s", INSTAGRAM_BUSINESS_ID)

    # Instagram requires a publicly accessible video URL.
    # Use local server to serve the video.
    video_url = _serve_video_locally(video_path)
    if not video_url:
        logger.error("[Instagram Direct] Cannot serve video for Instagram upload")
        return None

    try:
        # Step 1: Create media container for Reel
        container_url = f"{INSTAGRAM_GRAPH_URL}/{INSTAGRAM_BUSINESS_ID}/media"
        container_params = {
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "share_to_feed": "true",
            "access_token": INSTAGRAM_ACCESS_TOKEN,
        }

        resp = requests.post(container_url, data=container_params, timeout=30)

        if resp.status_code != 200:
            logger.error(
                "[Instagram Direct] Container creation failed (%d): %s",
                resp.status_code, resp.text[:500],
            )
            return None

        container_data = resp.json()
        container_id = container_data.get("id")

        if not container_id:
            logger.error(
                "[Instagram Direct] No container ID in response: %s",
                json.dumps(container_data)[:500],
            )
            return None

        logger.info("[Instagram Direct] Container created: %s, waiting for processing...", container_id)

        # Step 2: Poll for container status (video processing takes time)
        status_url = f"{INSTAGRAM_GRAPH_URL}/{container_id}"
        max_attempts = 30  # Up to 5 minutes (10s intervals)
        for attempt in range(max_attempts):
            time.sleep(10)

            status_resp = requests.get(
                status_url,
                params={
                    "fields": "status_code,status",
                    "access_token": INSTAGRAM_ACCESS_TOKEN,
                },
                timeout=15,
            )

            if status_resp.status_code != 200:
                logger.warning(
                    "[Instagram Direct] Status check failed (%d), retrying...",
                    status_resp.status_code,
                )
                continue

            status_data = status_resp.json()
            status_code = status_data.get("status_code")

            if status_code == "FINISHED":
                logger.info("[Instagram Direct] Video processing complete")
                break
            elif status_code == "ERROR":
                error_msg = status_data.get("status", "Unknown error")
                logger.error("[Instagram Direct] Processing error: %s", error_msg)
                return None
            elif status_code == "EXPIRED":
                logger.error("[Instagram Direct] Container expired before publishing")
                return None
            else:
                logger.debug(
                    "[Instagram Direct] Processing status: %s (attempt %d/%d)",
                    status_code, attempt + 1, max_attempts,
                )
        else:
            logger.error("[Instagram Direct] Timed out waiting for video processing")
            return None

        # Step 3: Publish the container
        publish_url = f"{INSTAGRAM_GRAPH_URL}/{INSTAGRAM_BUSINESS_ID}/media_publish"
        publish_params = {
            "creation_id": container_id,
            "access_token": INSTAGRAM_ACCESS_TOKEN,
        }

        publish_resp = requests.post(publish_url, data=publish_params, timeout=30)

        if publish_resp.status_code != 200:
            logger.error(
                "[Instagram Direct] Publish failed (%d): %s",
                publish_resp.status_code, publish_resp.text[:500],
            )
            return None

        publish_data = publish_resp.json()
        media_id = publish_data.get("id")

        logger.info(
            "[Instagram Direct] Reel published successfully! media_id=%s",
            media_id,
        )

        return {
            "platform": "instagram",
            "method": "direct_api",
            "media_id": media_id,
            "status": "published",
        }

    except requests.RequestException as e:
        logger.error("[Instagram Direct] Request error: %s", e)
        return None


def post_to_platform(
    platform: str,
    video_path: str,
    caption: str,
    dry_run: bool = False,
) -> dict | None:
    """
    Post a video to a platform using the best available method.

    Priority:
      1. Direct platform API (if credentials are configured)
      2. Buffer GraphQL API (fallback)

    On direct API failure, automatically falls back to Buffer.

    Args:
        platform: Platform name (tiktok, youtube, instagram)
        video_path: Path to the formatted video file
        caption: Post caption text
        dry_run: If True, log but don't actually post

    Returns:
        Result dict on success, None on failure.
    """
    if dry_run:
        logger.info(
            "[DRY RUN] Would post to %s: %s...",
            platform, caption[:80],
        )
        return {
            "dry_run": True,
            "platform": platform,
            "caption": caption[:80],
            "method": "dry_run",
        }

    result = None

    # Try direct API first based on platform
    if platform == "tiktok" and TIKTOK_ACCESS_TOKEN:
        logger.info("[%s] Attempting direct API posting...", platform)
        result = post_tiktok_direct(video_path, caption)
        if result:
            logger.info("[%s] Direct API posting succeeded", platform)
            return result
        else:
            logger.warning("[%s] Direct API failed, falling back to Buffer", platform)

    elif platform == "youtube" and YOUTUBE_REFRESH_TOKEN:
        logger.info("[%s] Attempting direct API posting...", platform)
        result = post_youtube_direct(video_path, caption)
        if result:
            logger.info("[%s] Direct API posting succeeded", platform)
            return result
        else:
            logger.warning("[%s] Direct API failed, falling back to Buffer", platform)

    elif platform == "instagram" and INSTAGRAM_ACCESS_TOKEN:
        logger.info("[%s] Attempting direct API posting...", platform)
        result = post_instagram_direct(video_path, caption)
        if result:
            logger.info("[%s] Direct API posting succeeded", platform)
            return result
        else:
            logger.warning("[%s] Direct API failed, falling back to Buffer", platform)

    else:
        logger.info(
            "[%s] No direct API credentials configured, using Buffer",
            platform,
        )

    # Fallback: post via Buffer
    return post_via_buffer(platform, video_path, caption)


def post_via_buffer(platform: str, video_path: str, caption: str) -> dict | None:
    """
    Post a video via Buffer as fallback.
    Handles upload to Buffer + creating the Buffer post.

    Returns:
        Result dict on success, None on failure.
    """
    channel = config.BUFFER_CHANNELS.get(platform)
    if not channel or not channel.get("enabled"):
        logger.warning("[Buffer Fallback] Channel %s not configured or disabled", platform)
        return None

    if check_rate_limit():
        logger.error("[Buffer Fallback] Rate-limited, cannot post to %s", platform)
        return None

    # Upload video to Buffer
    media_url = upload_video_to_buffer(video_path)
    if not media_url:
        logger.error("[Buffer Fallback] Failed to upload video for %s", platform)
        return None

    # Create the post
    result = create_buffer_post(
        channel_id=channel["id"],
        channel_name=channel["name"],
        platform=platform,
        caption=caption,
        media_url=media_url,
        schedule_mode="shareNow" if config.FIRST_POST_IMMEDIATE else "addToQueue",
    )

    if result:
        result["method"] = "buffer_fallback"

    return result


###############################################################################
# Buffer API Methods (kept as fallback)
###############################################################################


def upload_video_to_buffer(file_path: str) -> str | None:
    """
    Upload a video file to Buffer via their GraphQL uploadMedia mutation.
    First gets a signed S3 upload URL, then uploads the file, then confirms.

    Returns the uploaded media URL on success, None on failure.
    """
    if not config.BUFFER_TOKEN:
        logger.error("BUFFER_TOKEN not set")
        return None

    if check_rate_limit():
        return _serve_video_locally(file_path)

    file_size = Path(file_path).stat().st_size
    file_name = Path(file_path).name
    logger.info("Uploading video to Buffer: %s (%d bytes)", file_name, file_size)

    headers = {
        "Authorization": f"Bearer {config.BUFFER_TOKEN}",
        "Content-Type": "application/json",
    }

    # Step 1: Request a signed upload URL from Buffer
    upload_mutation = """
    mutation UploadMedia($input: UploadMediaInput!) {
        uploadMedia(input: $input) {
            ... on UploadMediaSuccess {
                uploadUrl
                uploadHeaders
                mediaUrl
                mediaId
            }
            ... on UploadMediaError {
                message
            }
        }
    }
    """

    variables = {
        "input": {
            "organizationId": config.BUFFER_ORG_ID,
            "contentType": "video/mp4",
            "fileName": file_name,
            "fileSize": file_size,
        }
    }

    try:
        resp = requests.post(
            config.BUFFER_API_URL,
            headers=headers,
            json={
                "operationName": "UploadMedia",
                "query": upload_mutation,
                "variables": variables,
            },
            timeout=30,
        )

        if resp.status_code != 200:
            logger.error("Buffer upload request failed (%d): %s", resp.status_code, resp.text[:500])
            handle_rate_limit_response(resp)
            return _serve_video_locally(file_path)

        data = resp.json()
        upload_data = data.get("data", {}).get("uploadMedia", {})

        if "uploadUrl" in upload_data:
            # Step 2: Upload file to signed URL
            upload_url = upload_data["uploadUrl"]
            upload_headers = upload_data.get("uploadHeaders", {})
            media_url = upload_data.get("mediaUrl")

            with open(file_path, "rb") as f:
                put_resp = requests.put(
                    upload_url,
                    data=f,
                    headers={**upload_headers, "Content-Type": "video/mp4"},
                    timeout=120,
                )

            if put_resp.status_code in (200, 201, 204):
                logger.info("Video uploaded to Buffer: %s", media_url or upload_url)
                return media_url or upload_url
            else:
                logger.error("S3 upload failed (%d): %s", put_resp.status_code, put_resp.text[:300])
                return _serve_video_locally(file_path)

        elif "message" in upload_data:
            logger.warning("Buffer upload mutation error: %s", upload_data["message"])
            return _serve_video_locally(file_path)
        else:
            logger.warning("Unexpected upload response: %s", json.dumps(data)[:500])
            return _serve_video_locally(file_path)

    except requests.RequestException as e:
        logger.error("Failed to upload video to Buffer: %s", e)
        return _serve_video_locally(file_path)


def _serve_video_locally(file_path: str) -> str | None:
    """
    Fallback: make video accessible via the RepostLaira backend server.
    Copies video to a public-accessible directory and returns the URL.
    """
    import shutil

    file_name = Path(file_path).name
    public_dir = Path("/opt/repostlaira-backend/public/videos")
    public_dir.mkdir(parents=True, exist_ok=True)

    dest = public_dir / file_name
    shutil.copy2(file_path, dest)

    public_url = f"http://198.105.115.219:3010/public/videos/{file_name}"
    logger.info("Video served locally: %s", public_url)
    return public_url


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

    if check_rate_limit():
        logger.error("Skipping %s post: rate-limited", platform)
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
            handle_rate_limit_response(resp)
            return None

    except requests.RequestException as e:
        logger.error("Request error posting to %s: %s", platform, e)
        return None


def post_video(video_info: dict, dry_run: bool = False) -> list[dict]:
    """
    Post a formatted video to all enabled platforms.
    Uses direct platform APIs when available, falls back to Buffer.
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

    for platform, file_path in formatted_paths.items():
        channel = config.BUFFER_CHANNELS.get(platform)
        if not channel or not channel.get("enabled"):
            logger.debug("Skipping disabled channel: %s", platform)
            continue

        # Use unified post_to_platform (direct API primary, Buffer fallback)
        result = post_to_platform(
            platform=platform,
            video_path=file_path,
            caption=caption,
            dry_run=dry_run,
        )

        method = "dry_run" if dry_run else (result.get("method", "unknown") if result else "failed")

        post_entry = {
            "video_id": video_info.get("id"),
            "platform": platform,
            "channel_name": channel["name"],
            "caption": caption,
            "file_path": file_path,
            "method": method,
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
    Post all formatted videos to social media with appropriate spacing.
    Uses direct platform APIs when available, Buffer as fallback.

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
    print()
    print("=== Direct API Credentials ===")
    print(f"  TikTok:    {'Configured' if TIKTOK_ACCESS_TOKEN else 'Not set (will use Buffer)'}")
    print(f"  YouTube:   {'Configured' if YOUTUBE_REFRESH_TOKEN else 'Not set (will use Buffer)'}")
    print(f"  Instagram: {'Configured' if INSTAGRAM_ACCESS_TOKEN else 'Not set (will use Buffer)'}")
    print()
    print("=== Buffer Fallback ===")
    print(f"  Buffer token: {'Yes' if config.BUFFER_TOKEN else 'No'}")
    print(f"  Enabled channels: {[n for n, c in config.BUFFER_CHANNELS.items() if c.get('enabled')]}")
