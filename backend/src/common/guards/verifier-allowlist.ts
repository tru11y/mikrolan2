/**
 * Routes accessibles au TICKET_VERIFIER (vendeur de vérification). Deny-by-default : toute route qui
 * n'est pas listée ici et qui ne déclare pas explicitement `@Roles(UserRole.TICKET_VERIFIER)` est
 * refusée en 403, y compris une route ajoutée demain sans `@Roles`.
 * Clé = `NomDuContrôleur.nomDeLaMéthode`. Chaque ajout est une décision de sécurité à justifier en revue.
 */
export const VERIFIER_ALLOWED_HANDLERS: ReadonlySet<string> = new Set([
  // Vérifier un ticket du routeur qui lui est affecté (déjà `@Roles(TICKET_VERIFIER)` + garde de périmètre).
  'TicketVerificationController.verify',
  // Session et compte : indispensables à l'app (connexion, jeton de rafraîchissement, notifications, CGU).
  'AuthController.me',
  'AuthController.changePassword',
  'AuthController.logoutAll',
  'AuthController.registerPushToken',
  'AuthController.unregisterPushToken',
  'AuthController.acceptLegal',
  // Contrôle de version de l'app (écran de mise à jour obligatoire).
  'TenantReleasesController.latest',
]);

export function isVerifierAllowed(controllerName: string, handlerName: string): boolean {
  return VERIFIER_ALLOWED_HANDLERS.has(`${controllerName}.${handlerName}`);
}
