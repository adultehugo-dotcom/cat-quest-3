using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CatQuestSetup
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    internal sealed class SetupForm : Form
    {
        private const string ReleaseBase =
            "https://github.com/adultehugo-dotcom/cat-quest-3/releases/latest/download/";
        private const string ArchiveName = "cat-quest-3-windows-x64.zip";
        private readonly TextBox folderInput;
        private readonly Button installButton;
        private readonly ProgressBar progressBar;
        private readonly Label statusLabel;
        private readonly CheckBox launchCheckBox;

        internal SetupForm()
        {
            Text = "Installation - Les Chroniques de Félingard";
            Width = 560;
            Height = 250;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;

            var title = new Label
            {
                Text = "Installer Les Chroniques de Félingard",
                Left = 20,
                Top = 18,
                Width = 500,
                Height = 28,
                Font = new System.Drawing.Font(Font, System.Drawing.FontStyle.Bold),
            };
            Controls.Add(title);

            Controls.Add(new Label
            {
                Text = "Dossier d'installation :",
                Left = 20,
                Top = 60,
                Width = 180,
                Height = 22,
            });

            folderInput = new TextBox
            {
                Left = 20,
                Top = 84,
                Width = 405,
                Text = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs",
                    "Les Chroniques de Félingard"),
            };
            Controls.Add(folderInput);

            var browseButton = new Button
            {
                Text = "Parcourir...",
                Left = 435,
                Top = 82,
                Width = 90,
            };
            browseButton.Click += BrowseForFolder;
            Controls.Add(browseButton);

            launchCheckBox = new CheckBox
            {
                Text = "Lancer le jeu à la fin de l'installation",
                Left = 20,
                Top = 120,
                Width = 300,
                Checked = true,
            };
            Controls.Add(launchCheckBox);

            progressBar = new ProgressBar
            {
                Left = 20,
                Top = 151,
                Width = 505,
                Height = 18,
                Style = ProgressBarStyle.Marquee,
                Visible = false,
            };
            Controls.Add(progressBar);

            statusLabel = new Label
            {
                Left = 20,
                Top = 174,
                Width = 390,
                Height = 24,
                Text = "La dernière version sera téléchargée depuis GitHub.",
            };
            Controls.Add(statusLabel);

            installButton = new Button
            {
                Text = "Installer",
                Left = 435,
                Top = 171,
                Width = 90,
            };
            installButton.Click += Install;
            Controls.Add(installButton);
            AcceptButton = installButton;
        }

        private void BrowseForFolder(object sender, EventArgs e)
        {
            using (var dialog = new FolderBrowserDialog())
            {
                dialog.Description = "Choisissez le dossier où installer le jeu.";
                dialog.SelectedPath = Directory.Exists(folderInput.Text)
                    ? folderInput.Text
                    : Path.GetDirectoryName(folderInput.Text);
                dialog.ShowNewFolderButton = true;
                if (dialog.ShowDialog(this) == DialogResult.OK)
                    folderInput.Text = dialog.SelectedPath;
            }
        }

        private async void Install(object sender, EventArgs e)
        {
            string destination;
            try
            {
                destination = Path.GetFullPath(folderInput.Text.Trim());
                if (string.IsNullOrWhiteSpace(folderInput.Text))
                    throw new InvalidOperationException("Choisissez un dossier d'installation.");
                if (Directory.Exists(destination) &&
                    Directory.GetFileSystemEntries(destination).Length > 0 &&
                    !File.Exists(Path.Combine(destination, ".cat-quest-3-install")))
                {
                    throw new InvalidOperationException(
                        "Le dossier choisi n'est pas vide. Choisissez un dossier vide ou celui d'une installation précédente.");
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(this, error.Message, "Dossier invalide", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            installButton.Enabled = false;
            folderInput.Enabled = false;
            progressBar.Visible = true;
            statusLabel.Text = "Téléchargement de la dernière version...";
            string archivePath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N") + ".zip");

            try
            {
                await Task.Run(() => DownloadAndInstall(destination, archivePath));
                CreateShortcuts(destination);
                statusLabel.Text = "Installation terminée.";
                progressBar.Visible = false;
                MessageBox.Show(
                    this,
                    "Le jeu a été installé. Un raccourci a été ajouté au menu Démarrer et sur le bureau.",
                    "Installation terminée",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);

                if (launchCheckBox.Checked)
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = Path.Combine(destination, "GameHost.exe"),
                        UseShellExecute = true,
                    });
                    Close();
                }
                else
                {
                    installButton.Enabled = true;
                    folderInput.Enabled = true;
                }
            }
            catch (Exception error)
            {
                progressBar.Visible = false;
                installButton.Enabled = true;
                folderInput.Enabled = true;
                statusLabel.Text = "L'installation a échoué.";
                MessageBox.Show(
                    this,
                    error.Message,
                    "Échec de l'installation",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            finally
            {
                if (File.Exists(archivePath))
                    File.Delete(archivePath);
            }
        }

        private static void DownloadAndInstall(string destination, string archivePath)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            using (var client = new HttpClient())
            {
                client.Timeout = TimeSpan.FromMinutes(15);
                client.DefaultRequestHeaders.UserAgent.ParseAdd("CatQuest3-Installer/1.0");
                var archiveUrl = ReleaseBase + ArchiveName;
                var checksumUrl = archiveUrl + ".sha256";
                var archiveBytes = client.GetByteArrayAsync(archiveUrl).GetAwaiter().GetResult();
                File.WriteAllBytes(archivePath, archiveBytes);
                var checksum = client.GetStringAsync(checksumUrl).GetAwaiter().GetResult();
                var match = Regex.Match(checksum, @"\A([0-9a-fA-F]{64})\s+");
                if (!match.Success)
                    throw new InvalidDataException("Le fichier de vérification SHA-256 de la release est invalide.");

                string actualHash;
                using (var sha256 = SHA256.Create())
                using (var stream = File.OpenRead(archivePath))
                {
                    actualHash = BitConverter.ToString(sha256.ComputeHash(stream)).Replace("-", "");
                }
                if (!string.Equals(actualHash, match.Groups[1].Value, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("La vérification SHA-256 du téléchargement a échoué.");
            }

            Directory.CreateDirectory(destination);
            File.WriteAllText(
                Path.Combine(destination, ".cat-quest-3-install"),
                "Les Chroniques de Félingard",
                Encoding.UTF8);
            ExtractArchiveSafely(archivePath, destination);
        }

        private static void ExtractArchiveSafely(string archivePath, string destination)
        {
            string root = Path.GetFullPath(destination).TrimEnd(Path.DirectorySeparatorChar) +
                Path.DirectorySeparatorChar;
            using (var archive = ZipFile.OpenRead(archivePath))
            {
                foreach (var entry in archive.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(
                        root,
                        entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("L'archive contient un chemin de fichier invalide.");

                    if (entry.FullName.EndsWith("/", StringComparison.Ordinal))
                    {
                        Directory.CreateDirectory(target);
                        continue;
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var input = entry.Open())
                    using (var output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                        input.CopyTo(output);
                }
            }
        }

        private static void CreateShortcuts(string destination)
        {
            string hostPath = Path.Combine(destination, "GameHost.exe");
            if (!File.Exists(hostPath))
                throw new InvalidDataException("Le paquet téléchargé ne contient pas les fichiers nécessaires au lancement du jeu.");
            string startMenu = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                "Programs",
                "Les Chroniques de Félingard");
            Directory.CreateDirectory(startMenu);

            CreateShortcut(
                Path.Combine(startMenu, "Les Chroniques de Félingard.lnk"),
                hostPath,
                destination);
            CreateShortcut(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    "Les Chroniques de Félingard.lnk"),
                hostPath,
                destination);
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDirectory)
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
                throw new InvalidOperationException("Windows Script Host n'est pas disponible pour créer les raccourcis.");
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetPath;
            shortcut.WorkingDirectory = workingDirectory;
            shortcut.Description = "Lancer Les Chroniques de Félingard dans le navigateur";
            shortcut.Save();
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut);
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        }
    }
}
