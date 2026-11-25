using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace CatQuestHost
{
    internal static class Host
    {
        private const int Port = 41731;
        private static readonly string SiteRoot = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "site");
        private static readonly TcpListener Listener = new TcpListener(IPAddress.Loopback, Port);
        private static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".css", "text/css; charset=utf-8" },
            { ".html", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".png", "image/png" },
            { ".svg", "image/svg+xml" },
            { ".webp", "image/webp" },
            { ".woff", "font/woff" },
            { ".woff2", "font/woff2" },
        };

        [STAThread]
        private static void Main()
        {
            try
            {
                if (!File.Exists(Path.Combine(SiteRoot, "index.html")))
                    throw new FileNotFoundException("Les fichiers du jeu sont absents du dossier d'installation.");

                Listener.Start();
                Listener.BeginAcceptTcpClient(AcceptClient, null);
                string address = "http://127.0.0.1:" + Port + "/";
                Console.WriteLine("Les Chroniques de Félingard sont ouvertes dans votre navigateur : " + address);
                if (Environment.GetEnvironmentVariable("CAT_QUEST_NO_BROWSER") == "1")
                {
                    Console.WriteLine("Ouverture automatique du navigateur désactivée pour la validation.");
                }
                else
                {
                    OpenBrowser(address);
                }
            }
            catch (SocketException)
            {
                Console.Error.WriteLine("Le port local " + Port + " est déjà utilisé. Fermez l'autre instance du jeu et réessayez.");
                Environment.ExitCode = 1;
                return;
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("Impossible de démarrer le jeu : " + error.Message);
                Environment.ExitCode = 1;
                return;
            }

            var stopped = new ManualResetEvent(false);
            Console.CancelKeyPress += (sender, args) =>
            {
                args.Cancel = true;
                stopped.Set();
                Listener.Stop();
            };
            stopped.WaitOne();
        }

        private static void OpenBrowser(string address)
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = address, UseShellExecute = true });
            }
            catch (InvalidOperationException error)
            {
                Console.WriteLine("Ouvrez cette adresse dans votre navigateur : " + address);
                Console.WriteLine(error.Message);
            }
            catch (Win32Exception error)
            {
                Console.WriteLine("Ouvrez cette adresse dans votre navigateur : " + address);
                Console.WriteLine(error.Message);
            }
        }

        private static void AcceptClient(IAsyncResult result)
        {
            TcpClient client;
            try
            {
                client = Listener.EndAcceptTcpClient(result);
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (SocketException)
            {
                return;
            }

            try
            {
                Listener.BeginAcceptTcpClient(AcceptClient, null);
            }
            catch (ObjectDisposedException)
            {
                client.Close();
                return;
            }
            catch (SocketException)
            {
                client.Close();
                return;
            }

            ThreadPool.QueueUserWorkItem(_ => ServeClient(client));
        }

        private static void ServeClient(TcpClient client)
        {
            using (client)
            using (var stream = client.GetStream())
            using (var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true))
            {
                try
                {
                    client.ReceiveTimeout = 5000;
                    string requestLine = reader.ReadLine();
                    if (string.IsNullOrEmpty(requestLine))
                    {
                        WriteError(stream, 400, "Bad Request");
                        return;
                    }

                    string[] requestParts = requestLine.Split(' ');
                    if (requestParts.Length < 2)
                    {
                        WriteError(stream, 400, "Bad Request");
                        return;
                    }

                    bool headOnly = requestParts[0] == "HEAD";
                    if (!headOnly && requestParts[0] != "GET")
                    {
                        WriteError(stream, 405, "Method Not Allowed");
                        return;
                    }

                    string requestPath = Uri.UnescapeDataString(requestParts[1].Split('?')[0]);
                    if (!requestPath.StartsWith("/", StringComparison.Ordinal))
                    {
                        WriteError(stream, 400, "Bad Request");
                        return;
                    }

                    string relativePath = requestPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string filePath = Path.GetFullPath(Path.Combine(SiteRoot, relativePath));
                    string rootPrefix = Path.GetFullPath(SiteRoot).TrimEnd(Path.DirectorySeparatorChar) +
                        Path.DirectorySeparatorChar;
                    if (filePath != Path.GetFullPath(SiteRoot) &&
                        !filePath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                    {
                        WriteError(stream, 404, "Not Found");
                        return;
                    }

                    if (Directory.Exists(filePath))
                        filePath = Path.Combine(filePath, "index.html");
                    if (!File.Exists(filePath))
                    {
                        WriteError(stream, 404, "Not Found");
                        return;
                    }

                    var info = new FileInfo(filePath);
                    string contentType;
                    if (!MimeTypes.TryGetValue(info.Extension, out contentType))
                        contentType = "application/octet-stream";

                    WriteHeaders(stream, 200, "OK", contentType, info.Length);
                    if (!headOnly)
                    {
                        using (var file = File.OpenRead(filePath))
                            file.CopyTo(stream);
                    }
                }
                catch (IOException error)
                {
                    Console.Error.WriteLine("Erreur lors de l'envoi d'un fichier : " + error.Message);
                }
                catch (UriFormatException)
                {
                    WriteError(stream, 400, "Bad Request");
                }
                catch (ArgumentException)
                {
                    WriteError(stream, 400, "Bad Request");
                }
                catch (UnauthorizedAccessException error)
                {
                    Console.Error.WriteLine("Accès refusé à un fichier du jeu : " + error.Message);
                    WriteError(stream, 500, "Internal Server Error");
                }
            }
        }

        private static void WriteError(Stream stream, int statusCode, string status)
        {
            try
            {
                byte[] body = Encoding.UTF8.GetBytes(status + "\n");
                WriteHeaders(stream, statusCode, status, "text/plain; charset=utf-8", body.Length);
                stream.Write(body, 0, body.Length);
            }
            catch (IOException error)
            {
                Console.Error.WriteLine("Impossible de répondre au navigateur : " + error.Message);
            }
        }

        private static void WriteHeaders(Stream stream, int statusCode, string status, string contentType, long length)
        {
            string headers = "HTTP/1.1 " + statusCode + " " + status + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + length + "\r\n" +
                "Cache-Control: no-cache\r\n" +
                "X-Content-Type-Options: nosniff\r\n" +
                "Connection: close\r\n\r\n";
            byte[] bytes = Encoding.ASCII.GetBytes(headers);
            stream.Write(bytes, 0, bytes.Length);
        }
    }
}
