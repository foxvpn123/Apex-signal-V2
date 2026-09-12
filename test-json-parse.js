const content = `Here is your result:
\`\`\`json
{
  "test": 123
}
\`\`\`
Hope this helps!`;

let cleaned = content;
const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
if (match) {
  cleaned = match[1];
} else {
  cleaned = content.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
}

console.log(JSON.parse(cleaned));
