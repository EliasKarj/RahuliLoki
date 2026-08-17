<div align="center">

# What Remains

**Path of Exile -varallisuusseuranta, joka kerää itse. Ei nappia jota painaa, ei tiliä
kolmannelle osapuolelle — oma kone, oma tietokanta.**

*Mitä liigasta jäi jäljelle, kun se paloi loppuun.*

`työpöytäohjelma` · `itse ylläpidetty` · `yksi käyttäjä` · `SQLite`

</div>

---

## Mitä tämä tekee

Kymmenen minuutin välein taustaprosessi

1. hakee poe.ninjan hinnat (välimuistissa tunnin),
2. lukee aarrearkun välilehdet GGG:n rajapinnasta yksi kerrallaan,
3. arvostaa jokaisen esineen, kertoo pinon koolla ja pudottaa kohinan,
4. kirjoittaa **yhden rivin**: kokonaisarvo chaosina ja divineina, divine-kurssi hetkellä,
   esinemäärä ja välilehtikohtainen erittely.

Sivu lukee rivit ja piirtää niistä nettoarvon, tuoton, esinetaulukon ja sen mikä liikkui.
Mitään ei tarvitse painaa: kaavio on ajan tasalla kun avaat sen viikon tauon jälkeen.

Keruu jatkuu myös ikkuna kiinni — se on tämän etu Exilence Nextiin nähden, joka keräsi vain
ollessaan auki.

---

## Asennus

**[Lataa asennuspaketti julkaisuista](https://github.com/EliasKarj/WhatRemains/releases/latest)**
— Windows (`.exe`), macOS (`.dmg`) tai Linux (`.AppImage`). Asenna, käynnistä, paina *Sign in
to Path of Exile*. Ohjelma avaa GGG:n oman kirjautumissivun omaan ikkunaansa; POESESSIDiä ei
tarvitse kaivaa devtoolsista eikä kirjoittaa mihinkään.

Muut tavat — lähdekoodista, Docker, Fly.io, `./start.sh` — ovat
**[asennusohjeessa](docs/asennus.md)**, samoin varmuuskopiot ja päivitys vanhasta
valuuttalokista.

```bash
# Lähdekoodista, jos haluat kääntää itse:
pnpm install
pnpm desktop            # kääntää ja käynnistää
pnpm desktop:package    # rakentaa asennuspaketin tälle alustalle
```

---

## Käyttö

Tili ja asetukset ovat **oikeassa ylänurkassa**: pieni nappi, jossa lukee tilin nimi ja jonka
piste kertoo onko istunto tallessa. Paneelissa on tasan yksi nappi jota painetaan —
kirjautuminen; kentät tallentavat itsensä.

| Asetus | Mitä |
|--------|------|
| Tilin nimi | Tulee GGG:ltä kirjautuessa. Käsin kirjoitettavissa vain hätävarana. |
| Liiga | Tallentuu valittaessa. *Other…* yksityisille liigoille. |
| Keräysväli | 5 / 10 / 15 / 30 / 60 min. Liian tiheä valinta kertoo itsestään — ks. alla. |
| Taustakeruu | Ikkunan sulkeminen piilottaa sen ilmaisinalueelle, kerääjä jatkaa. |

Ylärivi kertoo tilan: milloin viimeksi kerättiin, kuinka vanhat hinnat ovat, paljonko GGG:n
nopeusrajoituksesta on jäljellä ja **laskurin seuraavaan automaattiseen kierrokseen**.

> **▸ Miksi 5 minuuttia ei mahdu isoon arkkuun:** yksi kierros maksaa yhden pyynnön per
> välilehti, ja GGG:n arkkuraja on 200 pyyntöä tunnissa. Yhdeksäntoista välilehteä viiden
> minuutin välein on 228 — yli budjetin. Mitään ei hajoa: nopeusrajoitin tahdistaa itsensä ja
> kierrokset venyvät. Mutta se on hidastumista eikä tihenemistä, joten valikko sanoo sen
> ääneen. Kymmenen minuutin välein sama arkku on 114 ja mahtuu hyvin.

---

## Dokumentaatio

Jokaisen valinnan kohdalla on **▸ Miksi näin** -perustelu: mihin raja-arvo perustuu ja mitä se
ei kerro.

| | |
|---|---|
| **[Asennus](docs/asennus.md)** | Työpöytäohjelma, `./start.sh`, Docker, Fly.io, varmuuskopiot, päivitys valuuttalokista |
| **[Tunnukset ja pääsynhallinta](docs/turvallisuus.md)** | Miksi POESESSID on salasanan veroinen, miksi GGG:n OAuth ei tähän käy, mitä `AUTH_TOKEN` suojaa |
| **[Mitä sivu näyttää](docs/ulkoasu.md)** | Näkymät, Citadel at the End of Time -ulkoasu, ja miten luvut lasketaan |
| **[Mistä luvut tulevat](docs/sisalto.md)** | GGG:n nopeusrajoitus, poe.ninjan hinnat, esineiden nimien selvitys |
| **[Kehitys](docs/kehitys.md)** | Ympäristömuuttujat, rajapinta, testit, projektin rakenne |

---

## Tunnukset lyhyesti

POESESSID **on istuntoeväste, ei rajattu API-avain**. Sillä voi tehdä sivustolla kaiken minkä
sinäkin: lukea arkun, listata esineitä myyntiin, kirjoittaa foorumille. Siksi se

- ei koskaan päädy lokiin, selaimeen, osoitteeseen eikä prosessin argumentteihin,
- tallennetaan `0600`-oikeuksin käyttäjän omaan datahakemistoon,
- luetaan GGG:n omasta kirjautumisikkunasta, ei tekstikentästä.

Palvelin **kieltäytyy käynnistymästä** avoimeen verkkoon ilman `AUTH_TOKEN`ia. Perustelut ja
uhkamalli: **[Tunnukset ja pääsynhallinta](docs/turvallisuus.md)**.

---

## Julkaisun tekeminen

```bash
# 1. versio neljään package.jsoniin ja server/src/lib/config.ts:ään
# 2. tagi:
git tag v1.0.1 && git push origin v1.0.1
```

`.github/workflows/release.yml` kääntää asennuspaketit Windowsille, macOS:lle ja Linuxille
kukin omalla ajurillaan, ajaa testit ennen pakkaamista ja liittää tulokset julkaisuun.

---

## Lisenssi

MIT. Ei liity Grinding Gear Gamesiin.
