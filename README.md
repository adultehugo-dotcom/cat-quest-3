# Les Chroniques de Félingard

## Installer le jeu (Windows 10/11, 64 bits)

Téléchargez **Cat-Quest-3-Setup.exe** depuis la dernière [release GitHub](https://github.com/adultehugo-dotcom/cat-quest-3/releases/latest), lancez-le, puis choisissez le dossier d'installation. L'installateur récupère la version la plus récente du jeu et vérifie son empreinte SHA-256 avant de l'installer. Node.js n'est pas requis ; Windows 10/11 fournit normalement le .NET Framework 4.8 utilisé par l'installateur et le serveur local.

Le raccourci du bureau ou du menu Démarrer ouvre le jeu dans votre navigateur par l'intermédiaire d'un serveur local. La fenêtre noire du serveur doit rester ouverte pendant que vous jouez ; fermez-la pour arrêter le serveur. Les sauvegardes sont conservées par le navigateur.

Pour mettre le jeu à jour, fermez le serveur, relancez l'installateur de la dernière release et choisissez le même dossier. Pour désinstaller, fermez le serveur, supprimez les raccourcis puis le dossier d'installation.

## Développement

Installez Node.js 22 ou plus récent, puis lancez `npm ci`, `npm run dev`, `npm test -- --run` ou `npm run build`. Le script `start-game.bat` est destiné au développement ; l'installateur Windows distribué n'a pas besoin d'une installation Node.js séparée.
