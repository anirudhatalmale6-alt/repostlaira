#!/usr/bin/env python3
"""
ArialTravel Auto-Repost - Main Orchestrator

Automated pipeline for finding trending travel videos on TikTok,
formatting them with ArialTravel branding, and posting to social media via Buffer.

Usage:
    python main.py                  # Full pipeline (default: dry-run mode)
    python main.py --scrape-only    # Only scrape/download videos
    python main.py --format-only    # Only format already-downloaded videos
    python main.py --post-only      # Only post already-formatted videos
    python main.py --dry-run        # Run full pipeline without actually posting
    python main.py --live           # Run full pipeline WITH actual posting

IMPORTANT: Defaults to dry-run mode for safety. Use --live to actually post.
"""

import argparse
import json
import logging
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import config
from scraper import scrape_videos
from formatter import format_all_videos
from poster import post_all_videos, check_rate_limit

logger = logging.getLogger("auto-repost")


def setup_logging(log_dir: Path, verbose: bool = False) -> None:
    """Configure logging to both file and console."""
    log_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"auto_repost_{timestamp}.log"

    level = logging.DEBUG if verbose else logging.INFO

    # File handler - detailed
    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )

    # Console handler - concise
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    )

    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)

    logger.info("Logging to: %s", log_file)


def load_pending_videos() -> list[dict]:
    """
    Load video metadata from the processed database for videos that have
    been downloaded but not yet formatted/posted. Used for --format-only
    and --post-only modes.
    """
    if not config.DB_FILE.exists():
        return []

    with open(config.DB_FILE, "r") as f:
        db = json.load(f)

    videos = []
    for video_id, info in db.get("processed", {}).items():
        video_path = config.VIDEO_DIR / f"{video_id}.mp4"
        if video_path.exists():
            videos.append({
                "id": video_id,
                "local_path": str(video_path),
                "title": info.get("title", ""),
                "hashtags": [],
                "scraped_at": info.get("scraped_at"),
                "source_hashtag": info.get("hashtag", ""),
            })

    return videos


def find_formatted_videos() -> list[dict]:
    """
    Find videos that have already been formatted (for --post-only mode).
    Looks for formatted files and groups them by video ID.
    """
    formatted_dir = config.FORMATTED_DIR
    if not formatted_dir.exists():
        return []

    # Group formatted files by video ID
    video_files = {}
    for f in formatted_dir.glob("*.mp4"):
        # Filename format: {video_id}_{label}.mp4
        parts = f.stem.rsplit("_", 1)
        if len(parts) == 2:
            video_id, label = parts
            if video_id not in video_files:
                video_files[video_id] = {
                    "id": video_id,
                    "formatted_paths": {},
                    "hashtags": [],
                    "title": "",
                }

            # Map label back to platform
            for platform, fmt in config.VIDEO_FORMATS.items():
                if fmt["label"] == label:
                    video_files[video_id]["formatted_paths"][platform] = str(f)

    return list(video_files.values())


def run_pipeline(
    scrape: bool = True,
    format_videos: bool = True,
    post: bool = True,
    dry_run: bool = True,
    num_videos: int | None = None,
) -> dict:
    """
    Run the auto-repost pipeline.

    Args:
        scrape: Whether to scrape new videos.
        format_videos: Whether to format videos.
        post: Whether to post to Buffer.
        dry_run: If True, skip actual posting.
        num_videos: Number of videos to scrape (overrides config).

    Returns:
        Summary dict with results from each stage.
    """
    summary = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": dry_run,
        "stages": {},
    }

    videos = []

    # Stage 1: Scrape
    if scrape:
        logger.info("=" * 60)
        logger.info("STAGE 1: Scraping TikTok for travel videos")
        logger.info("=" * 60)
        try:
            videos = scrape_videos(num_videos)
            summary["stages"]["scrape"] = {
                "success": True,
                "videos_found": len(videos),
                "video_ids": [v["id"] for v in videos],
            }
            logger.info("Scraping complete: %d videos", len(videos))
        except Exception as e:
            logger.error("Scraping failed: %s", e)
            logger.debug(traceback.format_exc())
            summary["stages"]["scrape"] = {"success": False, "error": str(e)}
            if not format_videos and not post:
                return summary
            # Try to continue with existing videos
            videos = load_pending_videos()
            logger.info("Falling back to %d existing videos", len(videos))
    else:
        # Load existing videos for format/post stages
        videos = load_pending_videos()
        logger.info("Loaded %d existing videos", len(videos))

    # Stage 2: Format
    if format_videos and videos:
        logger.info("=" * 60)
        logger.info("STAGE 2: Formatting videos for each platform")
        logger.info("=" * 60)
        try:
            videos = format_all_videos(videos)
            summary["stages"]["format"] = {
                "success": True,
                "videos_formatted": len(videos),
            }
            logger.info("Formatting complete: %d videos ready", len(videos))
        except Exception as e:
            logger.error("Formatting failed: %s", e)
            logger.debug(traceback.format_exc())
            summary["stages"]["format"] = {"success": False, "error": str(e)}
            if not post:
                return summary
    elif post and not format_videos:
        # Post-only mode: use already-formatted videos
        videos = find_formatted_videos()
        logger.info("Found %d pre-formatted videos", len(videos))

    # Stage 3: Post
    if post and videos:
        logger.info("=" * 60)
        logger.info("STAGE 3: Posting to Buffer%s", " (DRY RUN)" if dry_run else "")
        logger.info("=" * 60)

        if not dry_run and check_rate_limit():
            logger.warning("Buffer API rate-limited, skipping posting. Will retry next run.")
            summary["stages"]["post"] = {"success": True, "total_posts": 0, "message": "Rate-limited, will retry"}
            summary["finished_at"] = datetime.now(timezone.utc).isoformat()
            return summary

        if dry_run:
            logger.info("DRY RUN MODE - no actual posts will be created")

        try:
            results = post_all_videos(videos, dry_run=dry_run)
            total = len(results)
            successes = sum(1 for r in results if r.get("success"))
            summary["stages"]["post"] = {
                "success": True,
                "dry_run": dry_run,
                "total_posts": total,
                "successful_posts": successes,
                "failed_posts": total - successes,
            }
            logger.info("Posting complete: %d/%d successful", successes, total)
        except Exception as e:
            logger.error("Posting failed: %s", e)
            logger.debug(traceback.format_exc())
            summary["stages"]["post"] = {"success": False, "error": str(e)}
    elif post and not videos:
        logger.warning("No videos available to post")
        summary["stages"]["post"] = {
            "success": True,
            "total_posts": 0,
            "message": "No videos to post",
        }

    summary["finished_at"] = datetime.now(timezone.utc).isoformat()

    # Log summary
    logger.info("=" * 60)
    logger.info("PIPELINE COMPLETE")
    logger.info("Summary: %s", json.dumps(summary, indent=2))
    logger.info("=" * 60)

    return summary


def main():
    parser = argparse.ArgumentParser(
        description="ArialTravel Auto-Repost: Scrape, format, and post travel videos.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    mode_group = parser.add_mutually_exclusive_group()
    mode_group.add_argument(
        "--scrape-only",
        action="store_true",
        help="Only scrape and download videos (no formatting or posting)",
    )
    mode_group.add_argument(
        "--format-only",
        action="store_true",
        help="Only format already-downloaded videos (no scraping or posting)",
    )
    mode_group.add_argument(
        "--post-only",
        action="store_true",
        help="Only post already-formatted videos (no scraping or formatting)",
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=None,
        help="Run without actually posting (overrides config)",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help="Actually post to Buffer (overrides dry-run default)",
    )
    parser.add_argument(
        "--num-videos", "-n",
        type=int,
        default=None,
        help=f"Number of videos to scrape (default: {config.VIDEOS_PER_RUN})",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )

    args = parser.parse_args()

    # Determine dry-run mode
    if args.live:
        dry_run = False
    elif args.dry_run:
        dry_run = True
    else:
        dry_run = config.DRY_RUN_DEFAULT

    # Setup logging
    setup_logging(config.LOG_DIR, verbose=args.verbose)

    logger.info("ArialTravel Auto-Repost starting...")
    logger.info("Mode: %s", "DRY RUN" if dry_run else "LIVE")

    if not config.BUFFER_TOKEN and not dry_run:
        logger.error("BUFFER_TOKEN not set. Set it in .env or environment.")
        logger.error("Cannot run in live mode without Buffer token.")
        sys.exit(1)

    # Determine which stages to run
    scrape = not args.format_only and not args.post_only
    format_v = not args.scrape_only and not args.post_only
    post = not args.scrape_only and not args.format_only

    try:
        summary = run_pipeline(
            scrape=scrape,
            format_videos=format_v,
            post=post,
            dry_run=dry_run,
            num_videos=args.num_videos,
        )

        # Exit with non-zero if any stage failed
        for stage_name, stage_result in summary.get("stages", {}).items():
            if not stage_result.get("success", False):
                sys.exit(1)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.critical("Unhandled error: %s", e)
        logger.debug(traceback.format_exc())
        sys.exit(1)


if __name__ == "__main__":
    main()
