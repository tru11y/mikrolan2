const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const cmd = (input.tool_input && input.tool_input.command) || '';
  const triggers = [
    'expo prebuild',
    'gradlew assemble',
    'gradlew install',
    'adb install',
  ];
  if (!triggers.some((t) => cmd.includes(t))) return;

  const expected = 'https://api.mikrolan.net/api';
  const envPath = path.join(process.cwd(), 'mobile', '.env.local');

  let value = null;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^EXPO_PUBLIC_API_BASE_URL=(.*)$/m);
    value = match ? match[1].trim() : null;
  } catch {
    value = null;
  }

  if (value === expected) return;

  const reason =
    `mobile/.env.local EXPO_PUBLIC_API_BASE_URL="${value ?? '(absent)'}" ` +
    `doit être "${expected}" avant un build réel. ` +
    `Cette valeur est figée dans l'APK au moment du build (expo prebuild / gradlew) — ` +
    `localhost/127.0.0.1 échoue silencieusement sur un téléphone physique (login impossible).`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
});
