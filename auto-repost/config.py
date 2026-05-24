"""
Configuration for the ArialTravel Auto-Repost system.
All settings can be overridden via .env file or environment variables.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from the same directory as this script
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# ─── Paths ────────────────────────────────────────────────────────────────────
VIDEO_DIR = Path(os.getenv("VIDEO_DIR", "/opt/repostlaira/auto-repost/videos"))
FORMATTED_DIR = Path(os.getenv("FORMATTED_DIR", "/opt/repostlaira/auto-repost/formatted"))
LOG_DIR = Path(os.getenv("LOG_DIR", "/opt/repostlaira/auto-repost/logs"))
DB_FILE = Path(os.getenv("DB_FILE", str(BASE_DIR / "processed_videos.json")))
POST_LOG_FILE = Path(os.getenv("POST_LOG_FILE", str(BASE_DIR / "post_log.json")))

# Ensure directories exist
VIDEO_DIR.mkdir(parents=True, exist_ok=True)
FORMATTED_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

# ─── Buffer API (GraphQL) ────────────────────────────────────────────────────
BUFFER_API_URL = "https://api.buffer.com/rpc"
BUFFER_TOKEN = os.getenv("BUFFER_TOKEN", "")
BUFFER_ORG_ID = os.getenv("BUFFER_ORG_ID", "69fa0cb360a17616e3fbbe78")

# Buffer channel IDs (verified 2026-05-18)
# Facebook is DISCONNECTED as of 2026-05-18
BUFFER_CHANNELS = {
    "tiktok": {
        "id": os.getenv("BUFFER_TIKTOK_ID", "6a0b71ce090476fb9933ea1a"),
        "name": "arialtravel",
        "enabled": os.getenv("BUFFER_TIKTOK_ENABLED", "true").lower() == "true",
        "scheduling_type": "automatic",  # IMPORTANT: "automatic" for direct posting, NOT "notification"
    },
    "youtube": {
        "id": os.getenv("BUFFER_YOUTUBE_ID", "6a02224b090476fb990b86f7"),
        "name": "ArialTravel",
        "enabled": os.getenv("BUFFER_YOUTUBE_ENABLED", "true").lower() == "true",
        "scheduling_type": "automatic",
    },
    "instagram": {
        "id": os.getenv("BUFFER_INSTAGRAM_ID", "6a022285090476fb990b87b9"),
        "name": "arialtravelclub",
        "enabled": os.getenv("BUFFER_INSTAGRAM_ENABLED", "true").lower() == "true",
        "scheduling_type": "automatic",
    },
    # Facebook is currently disconnected
    # "facebook": {
    #     "id": "69fa0e7f5c4c051afa1241a0",
    #     "name": "ArialTravel",
    #     "enabled": False,
    # },
}

# ─── yt-dlp Settings ─────────────────────────────────────────────────────────
YTDLP_PATH = os.getenv("YTDLP_PATH", "/usr/local/bin/yt-dlp")

# YouTube Shorts search queries (PRIMARY - works from data center IPs)
YOUTUBE_SEARCH_QUERIES = [
    "luxury hotel room tour",
    "travel vlog paris",
    "dubai luxury travel",
    "bali travel shorts",
    "rome travel 2026",
    "barcelona travel guide",
    "new york city travel",
    "luxury resort tour",
    "maldives travel",
    "santorini greece travel",
    "hotel suite tour",
    "travel tips shorts",
]

# TikTok hashtags (FALLBACK - may be blocked from data center IPs)
SEARCH_HASHTAGS = [
    "travel",
    "luxuryhotel",
    "paris",
    "dubai",
    "bali",
    "rome",
    "barcelona",
    "newyork",
    "luxurytravel",
    "travelgram",
    "wanderlust",
]

# Fallback: known travel creator URLs
FALLBACK_CREATOR_URLS = [
    "https://www.youtube.com/@luxuryescapes/shorts",
    "https://www.youtube.com/@kabortravel/shorts",
    "https://www.youtube.com/@TravelTired/shorts",
]

# ─── Video Filters ────────────────────────────────────────────────────────────
MIN_DURATION_SECONDS = 15
MAX_DURATION_SECONDS = 120
MIN_LIKES = 1000
VIDEOS_PER_RUN = int(os.getenv("VIDEOS_PER_RUN", "3"))
MAX_VIDEOS_PER_RUN = 5

# ─── Video Formatting ────────────────────────────────────────────────────────
FFMPEG_PATH = os.getenv("FFMPEG_PATH", "ffmpeg")
FFPROBE_PATH = os.getenv("FFPROBE_PATH", "ffprobe")

# Watermark text added to bottom corner of every video
WATERMARK_TEXT = "arialtravel.com"
WATERMARK_FONT_SIZE = 24
WATERMARK_OPACITY = 0.7

# Output formats per platform
VIDEO_FORMATS = {
    "tiktok": {
        "width": 1080,
        "height": 1920,
        "aspect": "9:16",
        "label": "vertical",
    },
    "instagram": {
        "width": 1080,
        "height": 1920,
        "aspect": "9:16",
        "label": "vertical",
    },
    "youtube": {
        "width": 1080,
        "height": 1920,
        "aspect": "9:16",
        "label": "vertical_short",
    },
    "facebook": {
        "width": 1080,
        "height": 1080,
        "aspect": "1:1",
        "label": "square",
    },
}

# ─── Posting Settings ─────────────────────────────────────────────────────────
# Minutes between each scheduled post to avoid spam
POST_SPACING_MINUTES = int(os.getenv("POST_SPACING_MINUTES", "120"))

# Whether the first post should go out immediately (shareNow) or be queued
FIRST_POST_IMMEDIATE = os.getenv("FIRST_POST_IMMEDIATE", "true").lower() == "true"

# ArialTravel website URL (included in captions)
WEBSITE_URL = "https://arialtravel.com"

# ─── Caption Templates (French) ──────────────────────────────────────────────
# These are rotated to keep captions varied.
# {hashtags} is replaced with relevant hashtags from the source video.
CAPTION_TEMPLATES = [
    "Decouvrez cette destination incroyable ! Ou partez-vous cet ete ?\n\n{hashtags}\n\n#ArialTravel #Voyage #Destination",
    "Un moment magique capture en video... Qui reve de partir ici ?\n\n{hashtags}\n\n#ArialTravel #VoyageDeLuxe #Evasion",
    "Cette destination fait rever ! Ajoutez-la a votre liste de voyages.\n\n{hashtags}\n\n#ArialTravel #Travel #Inspiration",
    "Le voyage commence ici. Laissez-vous transporter !\n\n{hashtags}\n\n#ArialTravel #Explorer #Aventure",
    "Imaginez-vous ici... Pret a reserver votre prochain voyage ?\n\n{hashtags}\n\n#ArialTravel #Wanderlust #VoyageDeReve",
    "La beaute du monde en quelques secondes. Quelle est votre prochaine destination ?\n\n{hashtags}\n\n#ArialTravel #TravelGoals #Paradis",
    "Evadez-vous le temps d'une video ! Ce lieu est simplement epoustouflant.\n\n{hashtags}\n\n#ArialTravel #LuxuryTravel #Decouverte",
    "Chaque voyage est une nouvelle histoire. Et vous, ou allez-vous ?\n\n{hashtags}\n\n#ArialTravel #VoyageInspiration #Monde",
    "Un endroit de reve qui merite d'etre visite au moins une fois !\n\n{hashtags}\n\n#ArialTravel #BucketList #TravelLife",
    "Fermez les yeux et imaginez-vous la-bas... Magnifique, non ?\n\n{hashtags}\n\n#ArialTravel #DreamDestination #BeauVoyage",
]

# Base hashtags always included
BASE_HASHTAGS = [
    "#ArialTravel",
    "#Voyage",
    "#Travel",
    "#LuxuryTravel",
    "#TravelGram",
]

# ─── Safety ───────────────────────────────────────────────────────────────────
# Default to dry-run mode for safety. Set to false to enable actual posting.
DRY_RUN_DEFAULT = os.getenv("DRY_RUN_DEFAULT", "true").lower() == "true"
