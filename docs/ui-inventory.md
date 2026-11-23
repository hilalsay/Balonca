# UI inventory and simplification proposal (phase 0b)

Measured on the live site, 23 November 2026, with Playwright: an iPhone 13 (390×844) and a laptop (1366×768).
"Visible" = buttons, links, inputs and tabs on the first screen without scrolling.
**Nothing below has been changed yet.** Every item keeps existing; only its place changes (Temel = stays in view,
İkincil = behind a "Daha fazla" menu, Gelişmiş = in Settings → Gelişmiş). Waiting for approval.

## Numbers

| Screen | Phone: visible | Phone: under 44×44 px | Laptop: visible | Laptop: under 44×44 px |
|---|---|---|---|---|
| Home | 12 | 3 | 13 | 3 |
| Watch | 36 | 30 | 78 | ~30 |
| Watch → Settings tab | 35 | 28 | 40 | 20 |
| Read (library) | 17 | 11 | 20 | 11 |
| Reader | ~25 | ~12 | ~40 | ~15 |
| My words | 20 | ~12 | 33 | 19 |
| Help | 13 | 3 | 18 | 3 |

(The watch count includes every word of the transcript, which are buttons by design; the player controls themselves are 10.)

## What is in the way today

1. **One setting, three places, three names.** "Çeviri dili" (which language subtitles are translated into),
   "Çeviri ve açıklama dili" (language of meanings and sentence translations) and "Başka bir dile de çevir" sit in
   the same Settings tab. People cannot tell them apart. "Felemenkçe" is offered for a Dutch video.
2. **Touch targets below 44 px** on phones: player buttons are 42 px, the subtitle "Aa" button 34 px, the word-card
   speaker 32 px, the language radio buttons in Read 13 px (their labels are big, the dots are not), header TR / theme
   buttons 40–42 px.
3. **Icon-only buttons**: header "TR" and "◐", player buttons, the "Aa" button, the sentence bubble. Fine on desktop
   with tooltips, unclear on a phone.
4. **Watch → Settings** shows the subtitle delay (−/+ 0.2 s) and remove buttons first, before the two things most
   people want (translation language, subtitle size).
5. **My words** opens with the language chips (Türkçe / İngilizce / Felemenkçe) above the main action.
6. **Laptop Watch**: the YouTube link field stays at the top after the video is open.
7. **Home**: on a laptop it is good; on a phone the two mode cards push "how it works" far down (fine).

## Proposal per screen

### Everywhere
- Temel: bottom bar (phone) / top bar (laptop) with icon + word. Header "TR" → "Türkçe ▾" with a word; theme moves
  to Settings → Temel ("Görünüm: Otomatik / Açık / Koyu").
- New in Settings → Temel: **Yazı boyutu: Normal / Büyük / Çok büyük** (`--font-scale`, whole app), asked once
  on the first visit.
- All touch targets ≥ 44×44 px on coarse pointers (`@media (pointer: coarse)`), without changing the laptop layout.

### Watch
| Item | Today | Proposed |
|---|---|---|
| Play, ±line, fullscreen | visible | **Temel** (44 px) |
| Speed, repeat line | visible | **İkincil** ("Daha fazla ⋯" next to play) |
| "Aa" subtitle position/size | small icon on the video | **İkincil**, plus in Settings → Temel as "Altyazı boyutu" |
| Translation language question | visible | **Temel** (once per video) |
| Link field (laptop) | always at the top | **İkincil**: folds away once a video plays, like on phones |
| Tabs Transkript / Kelimeler / Ayarlar | visible | **Temel** |

### Watch → Settings tab
| Item | Proposed |
|---|---|
| One **"Çeviri dili"** (merges "Çeviri dili" + "Çeviri ve açıklama dili"; the video's own language is not offered) | **Temel** |
| "Her seferinde sor / hep bu dil" | **Gelişmiş** |
| Subtitle size and position | **Temel** |
| Subtitle list with delay −/+ and remove | **Gelişmiş** ("Altyazılar" section) |
| "Başka bir dile de çevir" | **Gelişmiş** |
| Pause on word, colour words | **Temel** |
| Auto-scroll, auto-pause, subtitle style, background | **Gelişmiş** (already under "Daha fazla ayar") |

### Read
| Item | Proposed |
|---|---|
| Paste box, "Okumaya başla", sample texts | **Temel** |
| Language chips | **Temel**, but only when the guess is unsure; otherwise one line "Felemenkçe ✓ (değiştir)" |
| Title field | **İkincil** (filled from the first line) |
| .txt upload | **Temel** under one "+ Ekle" with PDF later (phase 4) |

### Reader
| Item | Proposed |
|---|---|
| Play bar: previous / play / next | **Temel** |
| Speed, repeat | **İkincil** (inside "⋯" on phones; visible on laptops) |
| Sentence bubble | **Temel**, 44 px hit area on phones |
| Hint card | first visit only (as today) |
| Translation under sentences, listening practice | **Gelişmiş** (reading settings, as today) |

### My words
| Item | Proposed |
|---|---|
| "N kelime seni bekliyor" + "Tekrara başla" | **Temel**, first |
| Search, sort | **Temel** below the hero |
| Language chips | **İkincil**: one line "Anlamlar: Türkçe ▾" (only languages that differ from the words' own) |
| Export / backup | **Gelişmiş** (as today, at the bottom) |
| Card actions: meaning, listen, go to source | **Temel**; fix ✏️ and delete ✕ → **İkincil** ("⋯" on the card), delete with 5 s "Geri al" |

### Cards (review)
Already one card and three answer buttons. Add keyboard hints 1/2/3 on laptops (exists) and the ⋯ menu nothing else.

## Next step
On approval, one PR applies this; screenshots before/after at 360, 390, 768, 1024, 1366 and 1920 px, light and
dark, Normal and "Çok büyük".
