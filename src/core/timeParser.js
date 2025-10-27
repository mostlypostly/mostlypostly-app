// src/core/timeParser.js
// AI-powered date/time extractor for stylist availability notes
import fetch from "node-fetch";

/**
 * Parse human-style messages like:
 * "I have openings Wednesday 2ish or Friday morning"
 * → [{ date: "2025-10-15", times: ["14:00"] }, { date: "2025-10-17", times: ["09:00", "11:00"] }]
 */
export async function parseNaturalAvailability(messageText) {
  if (!messageText?.trim()) return [];

  try {
    const prompt = `
You are an assistant that extracts real appointment availability from stylist messages.
Identify dates and times mentioned and return them in ISO format.
Output strict JSON only like:
[
  { "date": "YYYY-MM-DD", "times": ["HH:MM", "HH:MM"] }
]

Rules:
- Convert phrases like "tomorrow", "next week", "this Friday" to real ISO dates.
- Times like "2pm", "2:30", or "around 2ish" become "14:00".
- If only a day is mentioned, still return the date with an empty "times" array.
- Do not add text, commentary, or code fences.

Message:
"""${messageText}"""
`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
      })
    });

    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content?.replace(/```json|```/g, "").trim();

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      console.warn("⚠️ AI did not return array:", content);
      return [];
    } catch {
      console.warn("⚠️ Could not parse AI output:", content);
      return [];
    }
  } catch (err) {
    console.warn("⚠️ Availability parsing failed:", err.message);
    return [];
  }
}
