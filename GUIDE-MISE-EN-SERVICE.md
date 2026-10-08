# Mise en service du tableau de bord

Ce guide couvre tout ce qu'il reste à faire de votre côté : mettre le projet en ligne, puis brancher chaque source. Chaque étape est indépendante : le tableau de bord fonctionne dès la première, et s'enrichit à mesure que vous branchez les autres.

Les écrans de Google, Meta et LinkedIn changent souvent. Les intitulés ci-dessous peuvent donc différer un peu de ce que vous verrez ; le principe, lui, ne bouge pas.

## Comment ça marche

- Chaque matin, un programme interroge Google, Meta et LinkedIn avec vos clés, puis enregistre les chiffres dans un fichier **chiffré**.
- Le tableau de bord est une simple page web. Elle demande un mot de passe, déchiffre le fichier dans votre navigateur et affiche les chiffres.
- Tout est hébergé gratuitement sur GitHub. Vos clés y sont stockées dans un coffre (les « secrets ») que personne ne peut relire, pas même vous.

À savoir avant de commencer :

- **L'adresse du site est publique**, et le fichier chiffré aussi. Seul le mot de passe protège vos chiffres : choisissez une phrase longue (voir étape 2).
- Avec un compte GitHub gratuit, le dépôt doit être **public** pour que le site soit en ligne. Le code est donc visible, mais il ne contient aucune clé ni aucun chiffre lisible.
- **LinkedIn** exige une validation de leur part, qui peut prendre du temps ou être refusée. Les trois autres sources n'en dépendent pas.

## Étape 1 : mettre le projet en ligne

1. Créez un compte sur [github.com](https://github.com) si vous n'en avez pas.
2. Publiez le dossier `tableau-de-bord` dans un nouveau dépôt **public**. Deux façons simples :
   - avec Claude Code, ouvert dans le dossier : « Publie ce dossier dans un nouveau dépôt GitHub public nommé tableau-de-bord » ;
   - avec l'application [GitHub Desktop](https://desktop.github.com) : *File > Add local repository* (acceptez de créer le dépôt quand l'application le propose), puis *Publish repository* en décochant *Keep this code private*.

   Évitez le glisser-déposer sur le site de GitHub : il oublie le dossier caché `.github`, qui contient la mise à jour automatique.
3. Dans le dépôt, ouvrez **Settings > Pages** et choisissez **Source : GitHub Actions**. (Une première exécution se lance toute seule à la publication et échoue tant que ce réglage n'est pas fait : c'est normal.)
4. Ouvrez l'onglet **Actions**, sélectionnez « Mise à jour du tableau de bord », puis **Run workflow**.
5. Quelques minutes plus tard, l'adresse du site apparaît dans **Settings > Pages**. Ouvrez-la : vous voyez la version de démonstration, avec le mot de passe `demo`.

## Étape 2 : choisir le mot de passe

1. Dans le dépôt : **Settings > Secrets and variables > Actions > New repository secret**.
2. Nom : `DASHBOARD_PASSWORD`. Valeur : une phrase d'au moins quatre mots sans lien entre eux (par exemple quatre mots tirés au hasard). Évitez un nom de marque ou une date.
3. Relancez la mise à jour (onglet **Actions > Run workflow**). La démonstration disparaît : le tableau de bord est à vous, encore vide.

Pour changer de mot de passe plus tard, voir « Au quotidien ».

## Étape 3 : brancher Google Search Console

Le principe : vous créez un « compte de service » (un compte robot), puis vous l'invitez comme lecteur sur chacune de vos propriétés Search Console, quel que soit le compte Google qui les possède.

1. Ouvrez [console.cloud.google.com](https://console.cloud.google.com) et créez un projet (par exemple « Tableau de bord »).
2. Dans **API et services > Bibliothèque**, cherchez **Google Search Console API** et cliquez sur **Activer**.
3. Dans **IAM et administration > Comptes de service**, cliquez sur **Créer un compte de service**. Donnez-lui un nom, puis validez sans lui attribuer de rôle.
4. Ouvrez ce compte de service, onglet **Clés > Ajouter une clé > Créer une clé > JSON**. Un fichier se télécharge : gardez-le hors du dossier du projet.
5. Copiez l'adresse e-mail du compte de service (elle se termine par `.iam.gserviceaccount.com`).
6. Dans [Search Console](https://search.google.com/search-console), pour **chaque propriété** : **Paramètres > Utilisateurs et autorisations > Ajouter un utilisateur**, collez l'adresse, autorisation **Restreinte** (la lecture suffit).
7. Dans GitHub, créez le secret `GOOGLE_SERVICE_ACCOUNT_JSON` et collez-y **tout le contenu** du fichier JSON.
8. Relancez la mise à jour. Vos sites apparaissent, avec jusqu'à 16 mois d'historique.

Ajouter un site plus tard : refaites seulement le point 6. Il apparaîtra à la mise à jour suivante.

Si un même site existe en deux exemplaires dans Search Console (propriété « domaine » et propriété « préfixe d'URL »), les deux s'afficheront. Pour en masquer une, voir « Renommer ou masquer ».

## Étape 4 : brancher Instagram et Facebook

Conditions à vérifier d'abord :

- chaque compte Instagram est un compte **professionnel** (entreprise ou créateur) et il est **relié à une page Facebook** ;
- vos pages et vos comptes Instagram sont réunis dans un même **portefeuille business** sur [business.facebook.com](https://business.facebook.com).

Ensuite :

1. Sur [developers.facebook.com](https://developers.facebook.com), **Mes applications > Créer une application**, de type **Business**, rattachée à votre portefeuille business. Elle reste en mode développement : en principe, Meta ne demande pas de validation pour lire les comptes de votre propre portefeuille. Si une autorisation était refusée, le message exact apparaîtrait dans la page Sources.
2. Dans [business.facebook.com/settings](https://business.facebook.com/settings) : **Utilisateurs > Utilisateurs système > Ajouter**, rôle **Admin**.
3. Sélectionnez cet utilisateur système, puis **Attribuer des éléments** : cochez toutes vos **pages** et tous vos **comptes Instagram**.
4. Cliquez sur **Générer un jeton** : choisissez votre application, expiration **Jamais**, et cochez ces autorisations :
   `pages_show_list`, `pages_read_engagement`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, `business_management`.
5. Copiez le jeton (il ne sera plus affiché ensuite) et créez dans GitHub le secret `META_ACCESS_TOKEN`.
6. Relancez la mise à jour. La première dure plus longtemps : elle remonte 90 jours pour Instagram et un an pour Facebook.

Ajouter un compte plus tard : refaites seulement le point 3.

Limites fixées par Meta : pas de statistiques pour une page Facebook de moins de 100 mentions J'aime, ni de détail des nouveaux abonnés pour un compte Instagram de moins de 100 abonnés. Le nombre d'abonnés Instagram n'a pas d'historique chez Meta : la courbe se construit à partir du jour où vous branchez le compte.

## Étape 5 : brancher LinkedIn

C'est la seule source soumise à une validation.

1. Sur [linkedin.com/developers](https://www.linkedin.com/developers/), **Create app**, en l'associant à votre page d'entreprise. Un administrateur de la page doit ensuite **vérifier** l'application (un lien de vérification est proposé dans l'onglet *Settings*).
2. Onglet **Products** : demandez l'accès à **Community Management API** et remplissez le formulaire. LinkedIn examine la demande ; l'usage à décrire est le suivi des statistiques de vos propres pages.
3. Une fois l'accès accordé, ouvrez l'outil **OAuth 2.0 tools > Create token** (dans *Docs and tools*), cochez `r_organization_admin` (à défaut `rw_organization_admin`) et connectez-vous avec un compte **administrateur** de vos pages.
4. Créez dans GitHub le secret `LINKEDIN_ACCESS_TOKEN` avec ce jeton. Facultatif : ajoutez `LINKEDIN_CLIENT_ID` et `LINKEDIN_CLIENT_SECRET` (onglet *Auth* de l'application) pour que le tableau de bord affiche la date d'expiration.
5. Relancez la mise à jour.

Le jeton LinkedIn **expire au bout de 60 jours**. Le tableau de bord vous prévient deux semaines avant : refaites alors les points 3 et 4. Si LinkedIn vous fournit aussi un *refresh token*, enregistrez-le dans `LINKEDIN_REFRESH_TOKEN` avec l'identifiant et le secret : le renouvellement devient automatique pendant un an.

## Au quotidien

- **Mise à jour** : chaque matin, sans rien faire. Pour en forcer une : onglet **Actions > Run workflow**.
- **Délais des sources** : Google publie ses chiffres avec deux à trois jours de décalage, LinkedIn avec deux jours, Meta avec un jour (parfois deux).
- **Vérifier l'état des connexions** : page **Sources** du tableau de bord. Chaque compte y figure avec sa dernière date de données et, en cas de souci, le message exact renvoyé par le service.
- **Une mise à jour a échoué** : GitHub vous prévient par e-mail (réglage par défaut). Ouvrez l'onglet **Actions**, cliquez sur l'exécution en rouge : le message d'arrêt est écrit en clair à l'étape « Collecter les données ».

### Renommer ou masquer

Tout se règle dans `config.json`. Les identifiants à utiliser sont ceux des sources : pour un site, l'adresse telle que Search Console l'écrit (`sc-domain:exemple.fr` ou `https://www.exemple.fr/`) ; pour un compte, `ig:`, `fb:` ou `li:` suivi de son numéro.

```json
{
  "searchConsole": {
    "exclude": ["https://www.exemple.fr/"],
    "labels": { "sc-domain:exemple.fr": "Site principal" }
  }
}
```

Le plus simple : demandez à Claude Code « masque tel site » ou « renomme tel compte », il modifiera ce fichier.

### Changer le mot de passe

1. Créez le secret `DASHBOARD_PASSWORD_PREVIOUS` avec l'**ancien** mot de passe.
2. Modifiez `DASHBOARD_PASSWORD` avec le nouveau.
3. Relancez la mise à jour, puis supprimez `DASHBOARD_PASSWORD_PREVIOUS`.

Sans l'ancien mot de passe, la mise à jour s'arrête sans rien effacer : c'est voulu, pour ne pas perdre l'historique par accident.

### Voir le tableau de bord sur son ordinateur

Avec [Node.js](https://nodejs.org) installé (version 20 ou plus), dans le dossier du projet :

```
npm run demo      # données de démonstration, mot de passe : demo
npm run apercu    # ouvre http://localhost:4173
```
