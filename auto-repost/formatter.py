"""
Video Formatter

Adapts downloaded videos for each social media platform:
- Adds ArialTravel watermark
- Adjusts aspect ratio if needed (vertical 9:16, square 1:1)
- Outputs formatted files to the formatted/ directory
"""

import json
import logging
import subprocess
from pathlib import Path

import config

logger = logging.getLogger(__name__)


def get_video_info(video_path: str) -> dict | None:
    """
    Get video dimensions and duration using ffprobe.
    Returns dict with width, height, duration, or None on failure.
    """
    cmd = [
        config.FFPROBE_PATH,
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-show_format",
        video_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            logger.error("ffprobe failed for %s: %s", video_path, result.stderr[:300])
            return None

        data = json.loads(result.stdout)

        # Find video stream
        video_stream = None
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                video_stream = stream
                break

        if not video_stream:
            logger.error("No video stream found in %s", video_path)
            return None

        return {
            "width": int(video_stream.get("width", 0)),
            "height": int(video_stream.get("height", 0)),
            "duration": float(data.get("format", {}).get("duration", 0)),
            "codec": video_stream.get("codec_name", "unknown"),
        }
    except (subprocess.TimeoutExpired, json.JSONDecodeError, ValueError) as e:
        logger.error("Failed to probe %s: %s", video_path, e)
        return None


def is_vertical(width: int, height: int) -> bool:
    """Check if video is already in vertical (9:16-ish) orientation."""
    if height == 0:
        return False
    ratio = width / height
    # Consider vertical if aspect ratio is roughly 9:16 (0.5625) +/- tolerance
    return ratio < 0.7


def build_watermark_filter(width: int, height: int) -> str:
    """
    Build ffmpeg drawtext filter for the ArialTravel watermark.
    Places small white text with shadow in the bottom-right corner.
    """
    font_size = config.WATERMARK_FONT_SIZE
    opacity = config.WATERMARK_OPACITY

    # Position: bottom-right with 20px padding
    x = f"w-tw-20"
    y = f"h-th-20"

    # Shadow for readability on any background
    shadow_filter = (
        f"drawtext=text='{config.WATERMARK_TEXT}'"
        f":fontsize={font_size}"
        f":fontcolor=black@{opacity * 0.5}"
        f":x={x}+2:y={y}+2"
    )

    text_filter = (
        f"drawtext=text='{config.WATERMARK_TEXT}'"
        f":fontsize={font_size}"
        f":fontcolor=white@{opacity}"
        f":x={x}:y={y}"
    )

    return f"{shadow_filter},{text_filter}"


def format_vertical(input_path: str, output_path: str, target_w: int, target_h: int) -> bool:
    """
    Format video for vertical platforms (TikTok, Instagram Reels, YouTube Shorts).
    If already vertical, just adds watermark. Otherwise, crops/pads to 9:16.
    """
    info = get_video_info(input_path)
    if not info:
        return False

    src_w = info["width"]
    src_h = info["height"]

    watermark = build_watermark_filter(target_w, target_h)

    if is_vertical(src_w, src_h):
        # Already vertical - just scale to target and add watermark
        vf = (
            f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:black,"
            f"{watermark}"
        )
    else:
        # Horizontal video - crop center to 9:16 ratio then scale
        vf = (
            f"crop=ih*9/16:ih,"
            f"scale={target_w}:{target_h},"
            f"{watermark}"
        )

    return _run_ffmpeg(input_path, output_path, vf)


def format_square(input_path: str, output_path: str, target_w: int, target_h: int) -> bool:
    """
    Format video for square platforms (Facebook).
    Crops center to 1:1 ratio.
    """
    info = get_video_info(input_path)
    if not info:
        return False

    watermark = build_watermark_filter(target_w, target_h)

    # Crop to square (use the smaller dimension)
    vf = (
        f"crop=min(iw\\,ih):min(iw\\,ih),"
        f"scale={target_w}:{target_h},"
        f"{watermark}"
    )

    return _run_ffmpeg(input_path, output_path, vf)


def _run_ffmpeg(input_path: str, output_path: str, video_filter: str) -> bool:
    """Run ffmpeg with the given video filter chain."""
    cmd = [
        config.FFMPEG_PATH,
        "-y",  # Overwrite output
        "-i", input_path,
        "-vf", video_filter,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-max_muxing_queue_size", "1024",
        output_path,
    ]

    logger.debug("Running ffmpeg: %s", " ".join(cmd))

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0 and Path(output_path).exists():
            file_size = Path(output_path).stat().st_size
            logger.info("Formatted video: %s (%d bytes)", Path(output_path).name, file_size)
            return True
        else:
            logger.error("ffmpeg failed (exit %d): %s", result.returncode, result.stderr[:500])
            return False
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg timeout for %s", input_path)
        return False


def format_video(video_info: dict, platforms: list[str] | None = None) -> dict[str, str]:
    """
    Format a video for all target platforms.

    Args:
        video_info: Dict with at least 'local_path' and 'id' keys.
        platforms: List of platform names to format for. Defaults to all enabled channels.

    Returns:
        Dict mapping platform name to formatted file path.
    """
    input_path = video_info["local_path"]
    video_id = video_info["id"]

    if not Path(input_path).exists():
        logger.error("Source video not found: %s", input_path)
        return {}

    if platforms is None:
        platforms = [
            name for name, ch in config.BUFFER_CHANNELS.items()
            if ch.get("enabled", False)
        ]

    formatted_paths = {}

    for platform in platforms:
        fmt = config.VIDEO_FORMATS.get(platform)
        if not fmt:
            logger.warning("No format config for platform: %s", platform)
            continue

        output_filename = f"{video_id}_{fmt['label']}.mp4"
        output_path = str(config.FORMATTED_DIR / output_filename)

        # Skip if already formatted
        if Path(output_path).exists():
            logger.info("Already formatted: %s", output_filename)
            formatted_paths[platform] = output_path
            continue

        logger.info("Formatting %s for %s (%s)", video_id, platform, fmt["label"])

        if fmt["aspect"] == "1:1":
            success = format_square(input_path, output_path, fmt["width"], fmt["height"])
        else:
            success = format_vertical(input_path, output_path, fmt["width"], fmt["height"])

        if success:
            formatted_paths[platform] = output_path
        else:
            logger.error("Failed to format %s for %s", video_id, platform)

    return formatted_paths


def format_all_videos(videos: list[dict]) -> list[dict]:
    """
    Format a list of scraped videos for all platforms.
    Adds 'formatted_paths' key to each video info dict.

    Args:
        videos: List of video info dicts from scraper.

    Returns:
        Updated list with formatted_paths added to each entry.
    """
    formatted_videos = []

    for video_info in videos:
        paths = format_video(video_info)
        if paths:
            video_info["formatted_paths"] = paths
            formatted_videos.append(video_info)
            logger.info(
                "Formatted %s for %d platforms",
                video_info["id"], len(paths),
            )
        else:
            logger.warning("Could not format %s for any platform", video_info["id"])

    logger.info("Formatting complete: %d/%d videos ready", len(formatted_videos), len(videos))
    return formatted_videos


if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if len(sys.argv) < 2:
        print("Usage: python formatter.py <video_file.mp4>")
        print("Formats a single video for all platforms as a test.")
        sys.exit(1)

    test_path = sys.argv[1]
    test_info = {"id": Path(test_path).stem, "local_path": test_path}
    result = format_video(test_info)
    print(f"\nFormatted for {len(result)} platforms:")
    for platform, path in result.items():
        print(f"  {platform}: {path}")
