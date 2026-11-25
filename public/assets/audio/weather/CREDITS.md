# Crédits Audio — Météo & Ambiances Maritimes (« Les Chroniques de Félingard »)

Tous les fichiers de ce dossier sont de **vrais enregistrements acoustiques de terrain** (licences libres vérifiées sur Wikimedia Commons), traités localement avec FFmpeg 8.1.2 / DSP pour un bouclage sans couture, une égalisation propre, une normalisation calibrée (zéro clipping, `peak <= -1.8 dBFS`) et un poids optimisé pour le web (< 1 Mo au total).

## Tableau récapitulatif & provenance

| Fichier local | Canal | Titre original | Auteur | URL source exacte | Licence exacte | Format & poids | Durée | Peak / RMS (dBFS) |
|---|---|---|---|---|---|---|---:|---:|
| `ocean_waves.ogg` | `ocean` | `File:Oceanwavescrushing.ogg` (*Oceanwavescrushing*, Freesound #48412) | **Luftrum** | https://commons.wikimedia.org/wiki/File:Oceanwavescrushing.ogg | **CC BY 3.0** (https://creativecommons.org/licenses/by/3.0/) | Ogg Vorbis 44.1 kHz stéréo (~133 kbps), **323.8 Ko** (331 601 o) | 20.0 s (boucle) | -2.28 / -19.26 |
| `wind_gale.ogg` | `wind` | `File:Wind in Swedish pine forest at 25 mps.ogg` | **W.carter** | https://commons.wikimedia.org/wiki/File:Wind_in_Swedish_pine_forest_at_25_mps.ogg | **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/) | Ogg Vorbis 44.1 kHz stéréo (~112 kbps), **273.4 Ko** (279 965 o) | 20.0 s (boucle) | -3.97 / -19.21 |
| `rain_storm.ogg` | `rain` | `File:Bourne woods rain 2020-05-10 0757.mp3` | **Robert EA Harvey** | https://commons.wikimedia.org/wiki/File:Bourne_woods_rain_2020-05-10_0757.mp3 | **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/) | Ogg Vorbis 44.1 kHz stéréo (~137 kbps), **276.6 Ko** (283 272 o) | 16.5 s (boucle) | -1.83 / -19.27 |
| `thunder_clap.ogg` | `thunder` | `File:Nosferatu thunderclap - Richard Humphries.wav` (Freesound #2525) | **Richard Humphries** | https://commons.wikimedia.org/wiki/File:Nosferatu_thunderclap_-_Richard_Humphries.wav | **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/) | Ogg Vorbis 44.1 kHz stéréo (~151 kbps), **120.1 Ko** (123 010 o) | 6.5 s (one-shot) | -2.01 / -22.05 |

## Détails des traitements appliqués

1. **`ocean_waves.ogg`** (source originale : 120.0 s, 2.78 Mo, Zoom H2 stéréo à Røsnæs / Kalundborg Fjord) :
   - Découpe du segment `00:03.00 – 00:25.50` (vagues roulantes naturelles, sans silence d'intro).
   - Filtre passe-haut 32 Hz (suppression DC et infra-grondements parasites).
   - Boucle sans couture de **20.0 s** par crossfade à puissance constante (`cos`/`sin`) de 2.0 s entre fin et début.
   - Suppression résiduelle d'offset DC, limitation douce des transitoires et normalisation calibrée à **-19.26 dBFS RMS** (`peak -2.28 dBFS`, 0 échantillon saturé).
   - Encodage Ogg Vorbis (`libvorbis -q:a 4.5`, 44.1 kHz stéréo).

2. **`wind_gale.ogg`** (source originale : 60.48 s, 1.87 Mo, rafales côtières à 25 m/s à Lysekil, Suède) :
   - Découpe du segment `00:04.00 – 00:26.50` (rafales soutenues et aérées, sans saturation micro).
   - Rééchantillonnage 48 kHz -> 44.1 kHz, filtre passe-haut 45 Hz.
   - Boucle sans couture de **20.0 s** par crossfade à puissance constante de 2.0 s.
   - Suppression DC, normalisation calibrée à **-19.21 dBFS RMS** (`peak -3.97 dBFS`, 0 échantillon saturé).
   - Encodage Ogg Vorbis (`libvorbis -q:a 4.5`, 44.1 kHz stéréo).

3. **`rain_storm.ogg`** (source originale : 52.22 s, 1.65 Mo, Roland R-07 stéréo à Bourne Wood, Royaume-Uni) :
   - Découpe du segment `00:13.00 – 00:31.80` (averse régulière sans transitoires parasites ni oiseaux).
   - Rééchantillonnage 48 kHz -> 44.1 kHz, filtre passe-haut 70 Hz.
   - Boucle sans couture de **16.5 s** par crossfade à puissance constante de 2.0 s.
   - Suppression DC, limitation douce des gouttes très proches et normalisation calibrée à **-19.27 dBFS RMS** (`peak -1.83 dBFS`, 0 échantillon saturé).
   - Encodage Ogg Vorbis (`libvorbis -q:a 4.5`, 44.1 kHz stéréo).

4. **`thunder_clap.ogg`** (source originale : 25.07 s, 4.70 Mo PCM WAV 48 kHz stéréo) :
   - Découpe précise sur l'impact principal et le double grondement roulant (`00:03.24 – 00:09.74`, durée **6.5 s**, attaque immédiate à ~4.6 ms sans temps mort initial).
   - Rééchantillonnage 48 kHz -> 44.1 kHz, filtre passe-haut 24 Hz (préserve le poids grave tout en retirant le DC).
   - Micro fondu d'entrée anti-clic (10 ms Hann) et fondu de sortie naturel (1.10 s courbe douce).
   - Normalisation crête à **-2.01 dBFS** (`RMS -22.05 dBFS`, 0 échantillon saturé).
   - Encodage Ogg Vorbis (`libvorbis -q:a 5`, 44.1 kHz stéréo).

## Note de repli procédural & licences

- Tous les 4 enregistrements ont été téléchargés, vérifiés (magic bytes `OggS`, décodage intégral `ffprobe`/`ffmpeg`) et validés localement. Aucune requête réseau externe n'est effectuée au runtime.
- Un repli procédural Web Audio (bruit rose/brun filtré modulé pour mer/vent/pluie + grondement grave filtré pour tonnerre) reste intégré dans `src/audio/weatherAudio.ts` en cas d'échec de `fetch`/`decodeAudioData` (ex. environnement sans réseau/tests ou navigateur sans Vorbis).
- Les œuvres sous **CC BY-SA 4.0** (`wind_gale.ogg`, `rain_storm.ogg`) restent soumises au partage à l'identique (ShareAlike) pour ces assets audio dérivés ; leurs auteurs et sources exactes sont crédités ci-dessus.
