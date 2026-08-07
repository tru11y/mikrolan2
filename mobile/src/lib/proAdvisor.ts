import { formatXof, monthlyPrice, type Tier } from '@/src/config/tiers';

/**
 * Conseiller d'abonnement.
 *
 * L'écran PRO posait trois cartes de prix et laissait le client se débrouiller :
 * la seule question qu'il se pose vraiment — « laquelle pour *mon* cas ? » —
 * n'avait pas de réponse, et la demande d'activation partait sans le moindre
 * contexte pour l'administrateur qui la traite.
 *
 * Le moteur est scripté et local : il répond hors ligne, ne coûte rien par
 * message et ne dépend d'aucune clé d'API — ce qui compte quand le réseau est
 * le premier obstacle. Il raisonne sur les **capacités** des formules
 * (nombre de routeurs, accès distant, impression A4), jamais sur leurs noms :
 * le super admin peut renommer, retarifer ou ajouter une formule sans que ce
 * fichier bouge. L'interface `AdvisorEngine` isole l'implémentation pour qu'un
 * moteur conversationnel puisse la remplacer sans toucher à l'écran.
 */

export type AdvisorChoice = {
  id: string;
  label: string;
  /** Rendu en évidence : c'est la réponse la plus fréquente. */
  primary?: boolean;
};

export type AdvisorTurn = {
  /** Ce que le conseiller dit, une bulle par entrée. */
  say: string[];
  /** Réponses proposées. Vide = fin de parcours. */
  choices: AdvisorChoice[];
  /** Clé de la formule conseillée dès qu'elle est déterminée. */
  recommendation: string | null;
  /** Note transmise à l'administrateur avec la demande d'activation. */
  requestNote: string | null;
};

export interface AdvisorEngine {
  start(): AdvisorTurn;
  answer(choiceId: string): AdvisorTurn;
}

type Scale = 'small' | 'medium' | 'large';

type Profile = {
  scale: Scale | null;
  remote: boolean | null;
  printing: 'thermal' | 'a4' | 'unsure' | null;
};

const SCALE_LABEL: Record<Scale, string> = {
  small: '1 à 3 points WiFi',
  medium: '4 à 10 points WiFi',
  large: 'plus de 10 points WiFi',
};

/** Routeurs à couvrir au minimum pour chaque tranche déclarée. */
const SCALE_ROUTERS: Record<Scale, number> = { small: 3, medium: 10, large: 25 };

export class ScriptedAdvisor implements AdvisorEngine {
  private profile: Profile = { scale: null, remote: null, printing: null };

  /** `tiers` est la grille réellement publiée, pas une copie figée. */
  constructor(private readonly tiers: Tier[]) {}

  start(): AdvisorTurn {
    this.profile = { scale: null, remote: null, printing: null };
    return {
      say: [
        'Bonjour 👋 Je vous aide à choisir la formule qui correspond à votre activité — trois questions, moins d’une minute.',
        'Combien de points WiFi (routeurs) exploitez-vous aujourd’hui ?',
      ],
      choices: [
        { id: 'scale:small', label: '1 à 3', primary: true },
        { id: 'scale:medium', label: '4 à 10' },
        { id: 'scale:large', label: 'Plus de 10' },
      ],
      recommendation: null,
      requestNote: null,
    };
  }

  answer(choiceId: string): AdvisorTurn {
    const [key, value] = choiceId.split(':');

    if (key === 'scale') {
      this.profile.scale = value as Scale;
      return {
        say: [
          'Compris. Avez-vous besoin de gérer vos routeurs quand vous n’êtes pas sur place — depuis chez vous, ou d’une autre ville ?',
        ],
        choices: [
          { id: 'remote:yes', label: 'Oui, c’est important', primary: true },
          { id: 'remote:no', label: 'Non, je suis toujours sur place' },
          { id: 'remote:later', label: 'Peut-être plus tard' },
        ],
        recommendation: null,
        requestNote: null,
      };
    }

    if (key === 'remote') {
      // « Peut-être plus tard » n'est pas un oui : on ne vend pas une option
      // dont le client n'a pas encore l'usage.
      this.profile.remote = value === 'yes';
      return {
        say: ['Dernière question : comment remettez-vous les tickets à vos clients ?'],
        choices: [
          { id: 'printing:thermal', label: 'Petite imprimante Bluetooth', primary: true },
          { id: 'printing:a4', label: 'Feuilles A4 découpées' },
          { id: 'printing:unsure', label: 'Je ne sais pas encore' },
        ],
        recommendation: null,
        requestNote: null,
      };
    }

    if (key === 'printing') {
      this.profile.printing = value as Profile['printing'];
      const tier = this.recommend();
      if (!tier) {
        return {
          say: [
            'Aucune formule n’est publiée pour le moment. Envoyez tout de même une demande : un administrateur vous rappellera.',
          ],
          choices: [{ id: 'restart', label: 'Recommencer' }],
          recommendation: null,
          requestNote: this.note(null),
        };
      }
      return {
        say: [
          `Je vous conseille la formule ${tier.name}.`,
          this.why(tier),
          `Elle revient à ${formatXof(monthlyPrice(tier, false))} par mois, ou ${formatXof(monthlyPrice(tier, true))} par mois si vous réglez l’année (−${tier.annualDiscount} %).`,
          'Une question avant de vous décider ?',
        ],
        choices: this.questionChoices(true),
        recommendation: tier.key,
        requestNote: this.note(tier),
      };
    }

    if (key === 'ask') {
      const tier = this.recommend();
      return {
        say: this.objection(value, tier),
        choices: this.questionChoices(false),
        recommendation: tier?.key ?? null,
        requestNote: this.note(tier, value === 'human'),
      };
    }

    return this.start();
  }

  private questionChoices(first: boolean): AdvisorChoice[] {
    return [
      { id: 'ask:price', label: 'Pourquoi ce prix ?' },
      { id: 'ask:change', label: 'Puis-je changer de formule ?' },
      { id: 'ask:payment', label: 'Comment se passe le paiement ?' },
      first
        ? { id: 'ask:human', label: 'Je préfère parler à quelqu’un' }
        : { id: 'restart', label: 'Recommencer' },
    ];
  }

  /**
   * La moins chère des formules qui couvre réellement le besoin. Si aucune ne
   * le couvre (parc plus grand que tout ce qui est proposé), on prend la plus
   * capable plutôt que de ne rien conseiller.
   */
  private recommend(): Tier | null {
    const available = this.tiers.filter((t) => t.active);
    if (!available.length) return null;

    const routers = this.profile.scale ? SCALE_ROUTERS[this.profile.scale] : 1;
    const needsRemote = this.profile.remote === true;
    const needsA4 = this.profile.printing === 'a4';

    const byPrice = [...available].sort((a, b) => a.monthlyXof - b.monthlyXof);
    const fit = byPrice.find(
      (t) =>
        (t.routerLimit === null || t.routerLimit >= routers) &&
        (!needsRemote || t.remoteAccess) &&
        (!needsA4 || t.a4Printing),
    );
    return fit ?? byPrice[byPrice.length - 1];
  }

  private why(tier: Tier): string {
    const reasons: string[] = [];
    if (this.profile.scale) reasons.push(`vous gérez ${SCALE_LABEL[this.profile.scale]}`);
    if (this.profile.remote === true) reasons.push('vous voulez y accéder à distance');
    if (this.profile.printing === 'a4') reasons.push('vous imprimez des planches A4');
    const because = reasons.length
      ? `Parce que ${reasons.join(', ')}.`
      : 'D’après ce que vous m’avez indiqué.';
    return `${because} La formule ${tier.name} couvre ce besoin sans que vous payiez pour ce qui ne vous servira pas.`;
  }

  private objection(topic: string, tier: Tier | null): string[] {
    switch (topic) {
      case 'price':
        return [
          tier
            ? `${formatXof(tier.monthlyXof)} par mois, c’est l’équivalent de quelques tickets journée.`
            : 'Le tarif dépend de la formule retenue.',
          'Vous vendez vos forfaits au prix que vous fixez, et l’abonnement ne prend aucune commission sur vos ventes.',
        ];
      case 'change':
        return [
          'Oui, à tout moment, et sans frais.',
          'Vous pouvez monter de formule quand vous ajoutez des routeurs, ou redescendre si votre activité change. Aucun engagement de durée.',
        ];
      case 'payment':
        return [
          'Le règlement se fait par Wave ou Orange Money : vous envoyez le montant, un administrateur vérifie et active votre compte.',
          'Vous n’avez pas à saisir de numéro de carte dans l’application. Vous recevez une notification dans l’app dès que l’activation est faite.',
        ];
      case 'human':
        return [
          'Bien sûr. Envoyez la demande d’activation ci-dessous : elle arrive directement chez un administrateur avec le résumé de nos échanges.',
          'Il vous rappellera pour finaliser, sans que vous ayez à réexpliquer votre situation.',
        ];
      default:
        return ['Je n’ai pas la réponse à celle-là — demandez à être rappelé, ce sera plus sûr.'];
    }
  }

  /**
   * Résumé joint à `POST /subscriptions/request-upgrade`, que l'administrateur
   * retrouve dans sa file d'attente : il voit le besoin réel du client au lieu
   * d'un simple nom de formule.
   */
  private note(tier: Tier | null, wantsCallback = false): string {
    const parts = tier ? [`Formule conseillée : ${tier.name}`] : ['Sans formule publiée'];
    if (this.profile.scale) parts.push(`Parc : ${SCALE_LABEL[this.profile.scale]}`);
    if (this.profile.remote !== null)
      parts.push(`Accès distant : ${this.profile.remote ? 'requis' : 'non requis'}`);
    if (this.profile.printing)
      parts.push(
        `Impression : ${
          this.profile.printing === 'a4'
            ? 'A4'
            : this.profile.printing === 'thermal'
              ? 'thermique'
              : 'non décidée'
        }`,
      );
    if (wantsCallback) parts.push('⚠ Le client demande à être rappelé');
    return parts.join(' · ');
  }
}
