function isoWeek(date = new Date()) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value - yearStart) / 86400000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function inSendWindow(date = new Date(), catchupDays = Number(process.env.DIGEST_CATCHUP_DAYS) || 0) {
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  if (sinceMonday > Math.max(0, Math.min(6, catchupDays))) return false;
  return sinceMonday > 0 || date.getUTCHours() >= 9;
}

module.exports = { isoWeek, inSendWindow };
