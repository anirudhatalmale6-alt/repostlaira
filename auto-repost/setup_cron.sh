#!/bin/bash
# Setup cron jobs for ArialTravel Auto-Repost
#
# Runs main.py 3 times per day at Paris time (Europe/Paris = UTC+1 / UTC+2 DST):
#   08:00 Paris = 06:00 UTC (winter) / 06:00 UTC (summer with DST offset)
#   13:00 Paris = 11:00 UTC (winter) / 11:00 UTC (summer with DST offset)
#   19:00 Paris = 17:00 UTC (winter) / 17:00 UTC (summer with DST offset)
#
# To handle DST correctly, we use TZ=Europe/Paris in the cron entry.
#
# Usage:
#   chmod +x setup_cron.sh
#   ./setup_cron.sh           # Install cron jobs
#   ./setup_cron.sh --remove  # Remove cron jobs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="/usr/bin/python3"
MAIN_SCRIPT="${SCRIPT_DIR}/main.py"
LOG_DIR="/opt/repostlaira/auto-repost/logs"
CRON_MARKER="# ArialTravel Auto-Repost"

# Ensure log directory exists
mkdir -p "${LOG_DIR}"

# Load .env if it exists (to check for BUFFER_TOKEN)
if [ -f "${SCRIPT_DIR}/.env" ]; then
    source "${SCRIPT_DIR}/.env" 2>/dev/null || true
fi

remove_cron() {
    echo "Removing ArialTravel Auto-Repost cron jobs..."
    crontab -l 2>/dev/null | grep -v "${CRON_MARKER}" | crontab - 2>/dev/null || true
    echo "Done. Cron jobs removed."
}

install_cron() {
    # First remove any existing entries
    remove_cron

    echo "Installing ArialTravel Auto-Repost cron jobs..."
    echo "Schedule: 08:00, 13:00, 19:00 Paris time"

    # Build the cron command
    # NOTE: Uses --dry-run by default for safety. Change to --live when ready.
    CRON_CMD="cd ${SCRIPT_DIR} && TZ=Europe/Paris ${PYTHON} ${MAIN_SCRIPT} --dry-run >> ${LOG_DIR}/cron_\$(date +\%Y\%m\%d).log 2>&1"

    # Get existing crontab (or empty)
    EXISTING_CRON=$(crontab -l 2>/dev/null || echo "")

    # Add new entries
    NEW_CRON="${EXISTING_CRON}
${CRON_MARKER} - Morning (08:00 Paris)
0 6 * * * ${CRON_CMD}
${CRON_MARKER} - Afternoon (13:00 Paris)
0 11 * * * ${CRON_CMD}
${CRON_MARKER} - Evening (19:00 Paris)
0 17 * * * ${CRON_CMD}
"

    echo "${NEW_CRON}" | crontab -

    echo ""
    echo "Cron jobs installed successfully."
    echo ""
    echo "IMPORTANT: Jobs are set to --dry-run mode by default."
    echo "To enable live posting, edit this script or the cron entries"
    echo "and change --dry-run to --live."
    echo ""
    echo "Current crontab:"
    crontab -l | grep -A1 "${CRON_MARKER}" || echo "(none)"
    echo ""
    echo "Make sure BUFFER_TOKEN is set in ${SCRIPT_DIR}/.env"
}

# Handle arguments
case "${1:-}" in
    --remove|-r)
        remove_cron
        ;;
    *)
        install_cron
        ;;
esac
