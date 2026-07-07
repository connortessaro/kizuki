const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  const month = m && Number(m[2]);
  if (!m || month < 1 || month > 12) throw new Error(`invalid ISO date: ${JSON.stringify(isoDate)}`);
  return `${MONTHS[month - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function formatDateTime(date) {
  const h24 = date.getHours();
  const hour = h24 % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${hour}:${minutes} ${ampm}`;
}
