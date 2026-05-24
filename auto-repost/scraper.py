"""
Travel Video Scraper

Uses yt-dlp to find trending travel videos from YouTube Shorts (primary)
and TikTok (fallback), then downloads them for reposting.
"""

import json
import logging
import random
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import config

logger = logging.getLogger(__name__)


def load_processed_db() -> dict:
    """Load the database of already-processed video IDs."""
    if config.DB_FILE.exists():
        try:
            with open(config.DB_FILE, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            logger.warning("Corrupted processed_videos.json, starting fresh")
    return {"processed": {}, "last_updated": None}


def save_processed_db(db: dict) -> None:
    """Save the processed videos database."""
    db["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(config.DB_FILE, "w") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)


def extract_video_metadata(hashtag: str, max_results: int = 10) -> list[dict]:
    """
    Use yt-dlp to extract metadata from TikTok hashtag page.
    Returns a list of video metadata dicts.
    """
    url = f"https://www.tiktok.com/tag/{hashtag}"
    cmd = [
        config.YTDLP_PATH,
        "--dump-json",
        "--flat-playlist",
        "--no-download",
        "--playlist-end", str(max_results),
        "--no-warnings",
        "--ignore-errors",
        "--socket-timeout", "30",
        "--retries", "3",
        url,
    ]

    logger.info("Extracting metadata from TikTok hashtag: #%s", hashtag)
    logger.debug("Command: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        logger.warning("Timeout extracting #%s", hashtag)
        return []

    if result.returncode != 0 and not result.stdout.strip():
        logger.warning(
            "yt-dlp failed for #%s (exit %d): %s",
            hashtag, result.returncode, result.stderr[:500],
        )
        return []

    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            videos.append(data)
        except json.JSONDecodeError:
            continue

    logger.info("Found %d videos for #%s", len(videos), hashtag)
    return videos


def extract_full_metadata(video_url: str) -> dict | None:
    """
    Get full metadata for a specific TikTok video URL.
    Needed when flat-playlist doesn't include all fields.
    """
    cmd = [
        config.YTDLP_PATH,
        "--dump-json",
        "--no-download",
        "--no-warnings",
        "--socket-timeout", "30",
        video_url,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout.strip().split("\n")[0])
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        logger.warning("Failed to get full metadata for %s: %s", video_url, e)

    return None


def filter_video(meta: dict, processed_db: dict) -> bool:
    """
    Check if a video passes our quality/relevance filters.
    Returns True if the video should be downloaded.
    """
    video_id = meta.get("id") or meta.get("display_id") or meta.get("webpage_url", "")

    if not video_id:
        logger.debug("Skipping video with no ID")
        return False

    # Already processed
    if str(video_id) in processed_db.get("processed", {}):
        logger.debug("Skipping already processed video: %s", video_id)
        return False

    # Duration filter
    duration = meta.get("duration")
    if duration is not None:
        if duration < config.MIN_DURATION_SECONDS:
            logger.debug("Skipping %s: too short (%ds)", video_id, duration)
            return False
        if duration > config.MAX_DURATION_SECONDS:
            logger.debug("Skipping %s: too long (%ds)", video_id, duration)
            return False

    # Engagement filter (likes)
    like_count = meta.get("like_count")
    if like_count is not None and like_count < config.MIN_LIKES:
        logger.debug("Skipping %s: low engagement (%d likes)", video_id, like_count)
        return False

    return True


def download_video(video_url: str, output_path: Path) -> bool:
    """
    Download a TikTok video without watermark using yt-dlp.
    yt-dlp handles watermark removal for TikTok natively.
    """
    cmd = [
        config.YTDLP_PATH,
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout", "30",
        "--retries", "3",
        # Best quality MP4
        "-f", "best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", str(output_path),
        video_url,
    ]

    logger.info("Downloading video: %s", video_url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if result.returncode == 0 and output_path.exists():
            file_size = output_path.stat().st_size
            logger.info("Downloaded successfully: %s (%d bytes)", output_path.name, file_size)
            return True
        else:
            logger.error("Download failed (exit %d): %s", result.returncode, result.stderr[:500])
            return False
    except subprocess.TimeoutExpired:
        logger.error("Download timeout for %s", video_url)
        return False


def build_video_url(meta: dict) -> str | None:
    """Extract the best URL for a video from its metadata."""
    url = meta.get("webpage_url") or meta.get("url")
    if url:
        return url

    video_id = meta.get("id") or meta.get("display_id")
    uploader = meta.get("uploader") or meta.get("uploader_id")
    if video_id and uploader:
        return f"https://www.tiktok.com/@{uploader}/video/{video_id}"

    return None


def extract_video_info(meta: dict) -> dict:
    """Extract relevant info from video metadata for our database."""
    return {
        "id": meta.get("id") or meta.get("display_id", "unknown"),
        "title": meta.get("title") or meta.get("description", ""),
        "author": meta.get("uploader") or meta.get("creator", "unknown"),
        "author_url": meta.get("uploader_url", ""),
        "url": build_video_url(meta) or "",
        "duration": meta.get("duration"),
        "view_count": meta.get("view_count"),
        "like_count": meta.get("like_count"),
        "comment_count": meta.get("comment_count"),
        "hashtags": meta.get("tags", []),
        "description": meta.get("description", ""),
        "scraped_at": datetime.now(timezone.utc).isoformat(),
    }


def search_youtube_shorts(query: str, max_results: int = 10) -> list[dict]:
    """
    Search YouTube Shorts for travel videos using yt-dlp.
    Works reliably from data center IPs (unlike TikTok).
    """
    search_url = f"ytsearch{max_results}:{query} #shorts"
    cmd = [
        config.YTDLP_PATH,
        "--dump-json",
        "--flat-playlist",
        "--no-download",
        "--no-warnings",
        "--ignore-errors",
        "--socket-timeout", "30",
        "--retries", "3",
        "--match-filter", "duration < 120 & duration > 10",
        search_url,
    ]

    logger.info("Searching YouTube Shorts: %s", query)
    logger.debug("Command: %s", " ".join(cmd))

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        logger.warning("Timeout searching YouTube: %s", query)
        return []

    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            if data.get("url"):
                data["webpage_url"] = f"https://www.youtube.com/shorts/{data.get('id', data.get('url', ''))}"
            videos.append(data)
        except json.JSONDecodeError:
            continue

    logger.info("Found %d YouTube Shorts for '%s'", len(videos), query)
    return videos


def scrape_videos(num_videos: int | None = None) -> list[dict]:
    """
    Main scrape function. Searches YouTube Shorts (primary) and TikTok (fallback)
    for trending travel videos, filters them, downloads the best ones.

    Args:
        num_videos: Number of videos to download. Defaults to config.VIDEOS_PER_RUN.

    Returns:
        List of dicts with video info and local file paths.
    """
    target_count = min(num_videos or config.VIDEOS_PER_RUN, config.MAX_VIDEOS_PER_RUN)
    processed_db = load_processed_db()
    downloaded = []

    # PRIMARY: YouTube Shorts search
    queries = list(config.YOUTUBE_SEARCH_QUERIES)
    random.shuffle(queries)

    for query in queries:
        if len(downloaded) >= target_count:
            break

        videos_meta = search_youtube_shorts(query, max_results=10)

        if not videos_meta:
            logger.warning("No YouTube Shorts found for '%s'", query)
            time.sleep(2)
            continue

        random.shuffle(videos_meta)

        for meta in videos_meta:
            if len(downloaded) >= target_count:
                break

            if meta.get("_type") == "url" or meta.get("duration") is None:
                video_url = meta.get("webpage_url") or meta.get("url")
                if not video_url:
                    continue
                full_meta = extract_full_metadata(video_url)
                if full_meta:
                    meta = full_meta

            if not filter_video(meta, processed_db):
                continue

            video_url = meta.get("webpage_url") or meta.get("url") or build_video_url(meta)
            if not video_url:
                continue

            video_info = extract_video_info(meta)
            video_info["source_platform"] = "youtube"
            video_id = video_info["id"]

            output_path = config.VIDEO_DIR / f"{video_id}.mp4"
            if output_path.exists():
                logger.info("Video file already exists: %s", output_path.name)
            else:
                success = download_video(video_url, output_path)
                if not success:
                    continue

            video_info["local_path"] = str(output_path)
            video_info["source_hashtag"] = query
            downloaded.append(video_info)

            processed_db["processed"][str(video_id)] = {
                "scraped_at": video_info["scraped_at"],
                "hashtag": query,
                "source": "youtube",
                "title": video_info["title"][:100],
            }
            save_processed_db(processed_db)

            logger.info(
                "Scraped video %d/%d: %s (by %s, %d likes)",
                len(downloaded), target_count,
                video_id, video_info["author"],
                video_info.get("like_count") or 0,
            )
            time.sleep(3)

        time.sleep(2)

    # FALLBACK 1: TikTok hashtags
    if len(downloaded) < target_count:
        logger.info("Trying TikTok hashtags as fallback...")
        hashtags = list(config.SEARCH_HASHTAGS)
        random.shuffle(hashtags)

        for hashtag in hashtags:
            if len(downloaded) >= target_count:
                break

            videos_meta = extract_video_metadata(hashtag, max_results=15)
            if not videos_meta:
                time.sleep(2)
                continue

            random.shuffle(videos_meta)
            for meta in videos_meta:
                if len(downloaded) >= target_count:
                    break

                if meta.get("_type") == "url" or meta.get("duration") is None:
                    video_url = build_video_url(meta)
                    if not video_url:
                        continue
                    full_meta = extract_full_metadata(video_url)
                    if full_meta:
                        meta = full_meta

                if not filter_video(meta, processed_db):
                    continue

                video_url = build_video_url(meta)
                if not video_url:
                    continue

                video_info = extract_video_info(meta)
                video_info["source_platform"] = "tiktok"
                video_id = video_info["id"]

                output_path = config.VIDEO_DIR / f"{video_id}.mp4"
                if not output_path.exists():
                    if not download_video(video_url, output_path):
                        continue

                video_info["local_path"] = str(output_path)
                video_info["source_hashtag"] = hashtag
                downloaded.append(video_info)

                processed_db["processed"][str(video_id)] = {
                    "scraped_at": video_info["scraped_at"],
                    "hashtag": hashtag,
                    "source": "tiktok",
                    "title": video_info["title"][:100],
                }
                save_processed_db(processed_db)
                time.sleep(3)
            time.sleep(2)

    # FALLBACK 2: Creator profile URLs
    if not downloaded and config.FALLBACK_CREATOR_URLS:
        logger.info("Trying fallback creator URLs...")
        downloaded = _scrape_from_creators(target_count, processed_db)

    logger.info("Scraping complete: %d videos downloaded", len(downloaded))
    return downloaded


def _scrape_from_creators(target_count: int, processed_db: dict) -> list[dict]:
    """
    Fallback: scrape from known travel creator profiles instead of hashtags.
    Used when TikTok blocks hashtag page scraping from data center IPs.
    """
    downloaded = []

    for creator_url in config.FALLBACK_CREATOR_URLS:
        if len(downloaded) >= target_count:
            break

        logger.info("Trying fallback creator: %s", creator_url)
        videos_meta = []

        cmd = [
            config.YTDLP_PATH,
            "--dump-json",
            "--flat-playlist",
            "--no-download",
            "--playlist-end", "10",
            "--no-warnings",
            "--ignore-errors",
            creator_url,
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            for line in result.stdout.strip().split("\n"):
                if line.strip():
                    try:
                        videos_meta.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        except subprocess.TimeoutExpired:
            continue

        for meta in videos_meta:
            if len(downloaded) >= target_count:
                break

            if not filter_video(meta, processed_db):
                continue

            video_url = build_video_url(meta)
            if not video_url:
                continue

            video_info = extract_video_info(meta)
            video_id = video_info["id"]
            output_path = config.VIDEO_DIR / f"{video_id}.mp4"

            if not output_path.exists():
                if not download_video(video_url, output_path):
                    continue

            video_info["local_path"] = str(output_path)
            video_info["source_hashtag"] = "fallback_creator"
            downloaded.append(video_info)

            processed_db["processed"][str(video_id)] = {
                "scraped_at": video_info["scraped_at"],
                "hashtag": "fallback_creator",
                "title": video_info["title"][:100],
            }
            save_processed_db(processed_db)
            time.sleep(3)

    return downloaded


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    videos = scrape_videos()
    print(f"\nScraped {len(videos)} videos:")
    for v in videos:
        print(f"  - {v['id']}: {v['title'][:60]}... ({v.get('like_count', '?')} likes)")
