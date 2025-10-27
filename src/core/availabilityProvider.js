// src/core/availabilityProvider.js
// Mocked data for now; later can query DB or external booking APIs
export async function getSalonAvailability(salonName) {
  // Example: static or DB-driven
  return [
    { date: "Tue Oct 15", slots: ["10:00 AM", "1:30 PM", "4:00 PM"] },
    { date: "Wed Oct 16", slots: ["9:00 AM", "11:45 AM", "2:30 PM"] }
  ];
}

export function injectAvailabilityIntoCaption(caption, availabilityList) {
  if (!availabilityList?.length) return caption;
  const formatted = availabilityList
    .map(a => `${a.date}: ${a.slots.join(", ")}`)
    .join("\n");
  return `${caption}\n\n📅 *Upcoming openings:*\n${formatted}`;
}
