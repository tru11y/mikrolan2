process.stdout.write(
  JSON.stringify({
    systemMessage:
      "Rappel projet MikroLan : ne jamais déclarer une fonctionnalité prête sans l'avoir testée en conditions réelles (curl sur le vrai endpoint, tap réel + logcat sur mobile, vérification des logs de déploiement) — voir memory verify-before-done et test-everything-before-prod.",
    continue: true,
  }),
);
