# Serveur de notifications Nahar

Auteur : Eyoub Bouarfa

Petit serveur Cloudflare (gratuit) qui envoie les notifications de l'appli, même appli fermée.
L'appli calcule ses rappels des 30 prochains jours et les lui remet : des heures et des textes, jamais la position.

## Mise en ligne (une seule fois, environ 10 minutes)

1. Sur dash.cloudflare.com, menu **Storage & Databases → D1 SQL Database → Create**. Nom : `yawm-notifs`.
2. Menu **Workers & Pages → Create → Start with Hello World**. Nom : `yawm-notifs`, puis **Deploy**.
3. **Edit code** : tout effacer, coller le contenu de [`worker.js`](worker.js), puis **Deploy**.
4. Dans le Worker, **Settings → Bindings → Add → D1 database**. Nom de la variable : `DB`, base : `yawm-notifs`.
5. **Settings → Trigger events → Add → Cron Triggers**. Expression : `* * * * *` (chaque minute).
6. Ouvrir `https://yawm-notifs.<sous-domaine>.workers.dev/key` : une clé doit s'afficher.
   Mettre cette adresse (sans `/key`) dans `PUSH_URL` en haut du bloc Notifications d'`index.html`.

Les tables et les clés d'envoi se créent toutes seules au premier appel.

## Limites gratuites

Largement suffisantes pour quelques centaines d'utilisateurs : environ 160 rappels par personne et par mois.
