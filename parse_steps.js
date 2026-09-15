import fs from 'fs';
const content = fs.readFileSync('C:\\Users\\rajba\\.gemini\\antigravity-ide\\brain\\4809cd09-29b7-4241-95e4-c46858a90ad4\\.system_generated\\steps\\60\\content.md', 'utf8');
const stepsMatch = content.match(/{"name":"([^"]+)","status":"([^"]+)","conclusion":"([^"]+)"/g);
if (stepsMatch) {
    stepsMatch.forEach(s => console.log(s));
}
