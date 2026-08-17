# Asennus

Neljä tapaa ajaa sama ohjelma. Valmis asennuspaketti on niistä ensimmäinen ja useimmille ainoa;
loput ovat lähdekoodista ajamista varten.

[← back to the README](../README.md)

---

## Ennen kaikkea muuta: Node ja pnpm

Kaikki alla oleva olettaa **Node 22:n tai uudemman** ja **pnpm:n**. Kumpaakaan ei ole
missään valmiina, ja `pnpm` on se komento johon useimmat kompastuvat ensin:

```
pnpm : The term 'pnpm' is not recognized...
```

```bash
# Onko Node?
node -v                    # pitää olla v22 tai uudempi

# pnpm tulee Noden mukana tulevalla corepackilla:
corepack enable pnpm
```

Jos `node` puuttuu: [nodejs.org](https://nodejs.org) tai `winget install OpenJS.NodeJS.LTS`
(Windows) / `brew install node` (macOS). Avaa **uusi terminaali** asennuksen jälkeen.

Käynnistysskriptit tekevät tämän tarkistuksen puolestasi:
`./start.sh` (macOS, Linux) ja `.\start.ps1` (Windows).

---

## Työpöytäohjelma

**[Valmiit asennuspaketit ovat julkaisuissa](https://github.com/EliasKarj/WhatRemains/releases/latest)**
— Windows `.exe`, macOS `.dmg`, Linux `.AppImage`. Alla oleva on lähdekoodista kääntämistä
varten.

```bash
pnpm install
pnpm desktop            # kääntää ja käynnistää
pnpm desktop:package    # rakentaa asennuspaketin tälle alustalle
```

Windowsilla ilman erillistä pnpm-asennusta:

```powershell
.\start.ps1 -Desktop
```

Sama palvelin, sama paneeli — mutta oma ikkuna, ilmaisinalue ja **oikea kirjautuminen**.
Ohjelma avaa GGG:n kirjautumissivun omaan ikkunaansa, ja istunto luetaan siitä. POESESSIDiä
ei tarvitse kaivaa devtoolsista eikä liittää mihinkään.

Tili ja asetukset ovat **oikeassa ylänurkassa**: pieni nappi, jossa lukee tilin nimi ja jonka
piste kertoo onko istunto tallessa. Klikkaus avaa loput kolmena ryhmänä hiusviivoin erotettuna:
**kuka ja mikä liiga** (tilin nimi, liiga), **istunto** (kirjautuminen ja uloskirjaus) ja
**mitä kerääjä tekee** (keräysväli, taustakeruu, käynnistys koneen mukana). Ulkopuolinen
klikkaus tai Esc sulkee.

**Paneelissa on tasan yksi nappi jota painetaan: kirjautuminen.** Kentät tallentavat itsensä
— liiga valittaessa, tekstikentät kun ne menettävät kohdistuksen tai kun painaa Enteriä —
ja kirjautuminen tekee lopun.

> **▸ Miksi *Save* ja *Ask GGG* katosivat:** ne olivat kolme painallusta yhtä aikomusta kohti.
> *Save* kirjoitti liigan ja tilin nimen, *Ask GGG* korvasi juuri kirjoitetun nimen sillä jonka
> GGG kertoo, ja kirjautuminen todisti kenelle istunto kuuluu — eli kertoi saman nimen
> kolmannen kerran. Käyttöönottaja joutui painamaan kaikkia kolmea järjestyksessä jota mikään
> ruudulla ei selittänyt.
>
> Nyt kirjautuminen vie mukanaan lomakkeessa olevan liigan ja ottaa nimen GGG:ltä. Se *Ask
> GGG* -tapaus joka yhä merkitsee — tallessa oleva istunto jonka tilinimi jäi tyhjäksi —
> hoituu kirjautumisen sisällä, eikä tarvitse omaa nappia: ainoa hetki jolloin sen kysyminen
> kannattaa on juuri se hetki.
>
> Tilin nimen kenttä jäi silti kirjoitettavaksi. GGG:n vastaus on aina parempi kuin käsin
> kirjoitettu nimi, mutta kenttä on ainoa ulospääsy siltä varalta ettei `/api/profile` vastaa.

> **▸ Miksi nurkkaan:** kirjautuminen on ensimmäisellä käynnistyksellä ainoa asia jolla on
> väliä ja jokaisella seuraavalla viimeinen. Koko levyinen laatikko, jossa luki "kirjautuneena
> Exile#1234", työnsi ne luvut joiden takia ohjelma avattiin alemmas joka ainoa kerta. Nappi
> pitää tiedon näkyvissä ja ottaa yhden rivin.
>
> Kun jotain puuttuu, paneeli aukeaa itsestään eikä odota että se löydetään. Asetusruudun
> piilottaminen siltä joka ei ole vielä asettanut mitään olisi huonompi vaihtokauppa kuin se
> tila jonka se vie.

> **▸ Miksi kirjautumisikkuna on koko työpöytäversion syy:** ohje "avaa F12, etsi evästekaappi,
> kopioi arvo jonka juuri kerroimme olevan salasanan veroinen" on kolme askelta kitkaa ja yksi
> askel huonon tavan opettamista. Kuka tahansa joka oppii kaivamaan POESESSIDin pyynnöstä on
> yhden uskottavan sivuston päässä siitä että antaa sen jollekin muulle. Tässä tunnus ei kulje
> käyttäjän käsien kautta lainkaan.

> **▸ Miksi ikkuna odottaa GGG:n vahvistusta eikä pelkkää evästettä:** pathofexile.com asettaa
> POESESSID-evästeen **jo anonyymille kävijälle**, ennen kuin kukaan on kirjoittanut mitään.
> Ehto "eväste on olemassa" täyttyi siis puoli sekuntia sivun latauduttua: ikkuna sulkeutui,
> paneeli ilmoitti kirjautumisen onnistuneen, ja tallessa oli istunto jolla ei ollut tiliä.
>
> Seuraukset olivat pahempia kuin ilmeinen virhe olisi ollut. Kaikki näytti oikealta, GGG vastasi
> jokaiseen arkkupyyntöön 403, ja virheilmoitus syytti vanhentunutta istuntoa — mikä johti
> kirjautumaan uudestaan, mikä "onnistui" täsmälleen samalla väärällä tavalla.
>
> Eväste ei ole istunto ennen kuin GGG kertoo kenelle se kuuluu. Ikkuna kysyy `/api/profile`lta,
> joka tarvitsee pelkän istunnon eikä tilin nimeä, ja hyväksyy vain evästeen joka vastaa
> tilinimellä. Samalla tilin nimi tulee GGG:ltä eikä tekstikentästä.

Asetuspaneelissa valitaan myös **keräysväli** — 5, 10, 15, 30 tai 60 minuuttia. Valinta
kirjoitetaan samaan `POLL_CRON`-asetukseen jota palvelin lukee muutenkin, ja palvelin
käynnistyy sen jälkeen uudelleen taustalla.

> **▸ Miksi 5 minuuttia ei mahdu isoon arkkuun:** yksi kierros maksaa **yhden pyynnön per
> välilehti** — ensimmäinen pyyntö palauttaa välilehtiluettelon samassa vastauksessa, joten
> ylimääräistä ei tule. GGG:n arkkurajoitus on `200:3600:3600`, eli **200 pyyntöä tunnissa**.
>
> Yhdeksäntoista välilehteä viiden minuutin välein on 12 × 19 = **228 pyyntöä tunnissa**, eli
> yli budjetin. Kymmenen minuutin välein se on 114 ja mahtuu hyvin. Mitään ei hajoa yli
> mentäessä — nopeusrajoitin tahdistaa itsensä ja kierrokset venyvät, kunnes ne alkavat mennä
> päällekkäin seuraavan kanssa — mutta se on hidastumista eikä tihenemistä, joten valikko
> sanoo sen ääneen: liian tiheä valinta näyttää alleen punaisen rivin, jossa lukee laskettu
> tuntikulutus. Se on arkun omistajan päätös, ei ohjelman.
>
> Suurin väli jolla 19 välilehteä mahtuu on siis 10 min. Pienempi arkku mahtuu tiheämpään:
> kuusitoista välilehteä tai vähemmän mahtuu viiteen minuuttiin.

> **▸ Miksi ikkunan sulkeminen ei lopeta keruuta:** valvomaton keruu on tämän sovelluksen etu
> Exilence Nextiin nähden — se keräsi vain kun ohjelma oli auki. Sulkeminen piilottaa ikkunan
> ilmaisinalueelle ja kerääjä jatkaa. Lopettaminen on erillinen valinta ilmaisinalueen valikossa.

> **▸ Miksi Prisman CLI:tä ei paketoida mukaan:** se on 36 MB alustabinäärejä, joiden ainoa
> tehtävä valmiissa ohjelmassa olisi ajaa kourallinen CREATE TABLE -lauseita kerran
> käynnistyksessä. Migraatiot ajetaan samoista SQL-tiedostoista `node:sqlite`llä, ja CI
> tarkistaa Prismalta itseltään että lopputulos on identtinen. Tämä on myös syy siihen miksi
> Electron 38 on alaraja: sitä vanhemmat pakkaavat Node 20:n, jossa `node:sqlite`ä ei ole.

---

## Yksi komento (nopein)

```bash
git clone https://github.com/EliasKarj/WhatRemains.git what-remains
cd what-remains
./start.sh              # macOS, Linux
```

```powershell
git clone https://github.com/EliasKarj/WhatRemains.git what-remains
cd what-remains
.\start.ps1            # Windows
```

Kumpikin tarkistaa Noden, hankkii pnpm:n corepackilla jos se puuttuu, ja jatkaa siitä.

> **▸ Jos PowerShell kieltäytyy ajamasta skriptiä** (*running scripts is disabled on this
> system*), se on oletusarvoinen suorituskäytäntö eikä vika tiedostossa:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

Skripti tarkistaa Noden ja pnpm:n, kysyy tunnukset (POESESSID syötetään näkymättömänä ja
tallentuu `.env`:iin oikeuksilla 0600), ajaa migraatiot, kääntää, käynnistää palvelimen ja
tekee **yhden** oikean kierroksen kertoakseen heti toimiiko tunnus. Sen jälkeen sivu on
osoitteessa <http://localhost:3000>.

| Lippu | Mitä |
|-------|------|
| `./start.sh` | Asennus tarvittaessa, käännös, käynnistys |
| `./start.sh --dev` | Palvelin ja Vite hot reloadilla kehitystä varten |
| `./start.sh --seed` | Täyttää kannan keksityllä datalla, jotta kaavioita voi katsoa heti |
| `./start.sh --check` | Tarkistaa kaiken käynnistämättä mitään |
| `./start.sh --reconfigure` | Kysyy tunnukset uudelleen (vanha `.env` varmuuskopioidaan) |

> **▸ Miksi skripti tekee oikean kierroksen eikä vain käynnisty:** ainoa tapa tietää toimiiko
> POESESSID on käyttää sitä. Yksi pyyntö, ei uudelleenyritystä — se kuluttaisi toisen
> pyynnön samasta budjetista, jota koko nopeusrajoitin varjelee, kertomatta mitään uutta.

> **▸ Miksi tunnusta ei tarkisteta suoraan skriptistä curlilla:** palvelimessa on jo
> nopeusrajoitin ja hyvät virheilmoitukset. Toinen, tyhmempi toteutus kuoressa erkaantuisi
> niistä ja ampuisi GGG:tä ämpäreistä välittämättä.

---

## Docker (suositeltu palvelimelle)

```bash
git clone https://github.com/EliasKarj/WhatRemains.git what-remains
cd what-remains
cp .env.example .env      # täytä POESESSID ja POE_ACCOUNT_NAME
docker compose up -d
```

Sivu on osoitteessa <http://localhost:3000>. Ensimmäinen tilannekuva syntyy seuraavalla
ajastimen herätyksellä, tai heti kun painat sivulta **poll now**.

Compose julkaisee portin vain silmukkaosoitteeseen (`127.0.0.1:3000`), joten tokenia ei
tarvita. Jos muutat tuon `3000:3000`:ksi, aseta myös `AUTH_TOKEN` — muuten palvelin
kieltäytyy käynnistymästä ja kertoo miksi. Ks. [Pääsynhallinta](turvallisuus.md#pääsynhallinta).

---

## Fly.io

`fly.toml` on valmiina. Levy pitää luoda ennen ensimmäistä julkaisua, ja tunnus menee
`fly secrets`iin eikä tiedostoon:

```bash
fly launch --no-deploy --copy-config
fly volumes create what_remains_data --size 1 --region arn
fly secrets set POESESSID=… POE_ACCOUNT_NAME='Exile#1234' POE_LEAGUE=Settlers \
  AUTH_TOKEN="$(openssl rand -hex 32)"
fly deploy
```

`AUTH_TOKEN` ei ole tässä valinnainen. Fly julkaisee sovelluksen julkiseen internetiin, ja
palvelin kieltäytyy käynnistymästä ilman sitä. Selain kysyy tokenin kerran ja pitää sen
välilehden ajan.

`auto_stop_machines = false` on tahallinen: nukkuva kone ei kerää mitään, ja kerääminen on
koko sovelluksen tarkoitus.

---

## Paikallisesti ilman konttia

```bash
pnpm install
pnpm --filter @whatremains/server exec prisma generate
pnpm db:migrate
cp .env.example .env      # täytä tunnukset
pnpm dev                  # palvelin :3000, selainpuoli :5173
```

Vite proxyttaa `/api`-pyynnöt palvelimelle, joten kehityksessäkin puhutaan vain suhteellisiin
osoitteisiin.

---

## Missä tiedot ovat

Asennettu ohjelma pitää kaiken omansa käyttäjän datahakemistossa — ei koskaan ohjelman
sisällä, jotta päivitys korvaa ohjelman ja jättää liigan historian rauhaan.

| | Windows | macOS | Linux |
|---|---|---|---|
| Hakemisto | `%APPDATA%\What Remains` | `~/Library/Application Support/What Remains` | `~/.config/What Remains` |

Sen sisällä: `settings.json` (istunto, `0600`-oikeuksin), `what-remains.db` (tilannekuvat) ja
`logs/what-remains.log`.

> **▸ Miksi loki on tiedostossa eikä konsolissa:** asennettu ohjelma on ikkunallinen ohjelma.
> Windowsissa sellaisella ei ole konsolia lainkaan, joten jokainen lokirivi kirjoittuisi
> tyhjään — ja vaihtoehto, konsoli-ikkunan avaaminen ohjelman viereen niitä pitämään, on
> terminaali jota kukaan ei pyytänyt istumassa tehtäväpalkissa koko istunnon ajan.
>
> Ilmaisinalueen valikossa on **Open log**, koska tiedosto on parannus vain jos sen löytää
> tietämättä mihin Electron datahakemistonsa laittaa. Lähdekoodista ajettaessa loki tulee yhä
> stdoutiin, koska se on lähdekoodista ajamisen koko pointti.

---

## Päivitys valuuttalokista

Ohjelma oli aiemmin nimeltään **valuuttaloki**. Nimi vaihtui, ja nimi on osa muutamaa polkua.

**Työpöytäversio hoitaa itse.** Electron johtaa data­hakemistonsa sovelluksen nimestä, joten
nimenmuutos siirsi kansion vanhan asennuksen alta. Ensimmäisellä käynnistyksellä ohjelma
**kopioi** vanhasta kansiosta `settings.json`in ja tietokannan uuteen — istunto, tili ja koko
historia siirtyvät mukana. Vanhaa kansiota ei poisteta eikä muuteta.

> **▸ Miksi kopio eikä siirto:** jos tässä siirrossa on jokin vika jota kukaan ei ole vielä
> keksinyt, alkuperäinen on yhä tallella. Siirto käyttäisi ainoan kopion muutaman megatavun
> säästämiseen.
>
> **▸ Miksi vain tyhjään kansioon:** jos uusi versio on jo käynnistetty ja siihen on
> kirjauduttu, sen tila on tuoreempi kuin vanhan kansion. Kahdesti ajettu siirto palauttaisi
> vanhentuneen istunnon tuoreen päälle.

**Docker ja itse ylläpidetty asennus vaativat yhden käden liikkeen.** Tiedoston nimi
`docker-compose.yml`:ssä ja `fly.toml`:ssa on nyt `what-remains.db`, samoin palvelun,
kontin ja levyn nimet. Vanha data on yhä levyllä vanhalla nimellä, joten valitse jompikumpi:

```bash
# joko nimeä tiedosto levyllä uudelleen…
docker compose stop
docker compose run --rm what-remains mv /data/valuuttaloki.db /data/what-remains.db

# …tai jätä DATABASE_URL osoittamaan vanhaan nimeen
DATABASE_URL=file:/data/valuuttaloki.db
```

Kumpikin käy. Se mitä **ei** kannata tehdä on käynnistää uudella nimellä ja ihmetellä tyhjää
kaaviota: tietokanta ei ole kadonnut, se on eri tiedostossa.

Selaimen `sessionStorage`-avain vaihtui myös, joten tokenilla suojattu asennus kysyy tokenin
kerran uudestaan.

---

## Varmuuskopiot ja liigan vaihtuminen

Tietokanta on yksi tiedosto, ja rivejä vain lisätään — mitään ei päivitetä eikä poisteta.

```bash
docker compose stop
docker compose cp what-remains:/data/what-remains.db varmuuskopio.db
docker compose start
```

> **▸ Miksi pysäytys:** kerääjä kirjoittaa kymmenen minuutin välein ja kirjoitus kestää
> millisekunteja, joten kopiointi käynnissä olevasta kontista osuu kirjoituksen päälle hyvin
> harvoin. Harvoin ei ole sama kuin ei koskaan, ja rikkinäisen varmuuskopion huomaa vasta kun
> sitä tarvitsee. Kahden sekunnin katko on halvempi.

Tilannekuvat avaimitetaan liigalla, eikä liigoja sekoiteta samaan sarjaan. Kun uusi liiga alkaa,
vaihda `POE_LEAGUE` ja käynnistä kontti uudelleen — vanha sarja jää tallelle ja sen voi valita
sivun yläreunan valikosta. Standard on oma, lähes muuttumaton sarjansa.

> **▸ Miksi erittely tallennetaan kokonaan:** rivi sisältää välilehtikohtaisen esineerittelyn,
> ei pelkkää loppusummaa. Se maksaa tilaa, mutta antaa mahdollisuuden viipaloida historiaa
> jälkikäteen — "paljonko omaisuutta olisi ilman sitä yhtä onnekasta droppia" — hakematta
> mitään uudelleen. Uudelleenhakeminen ei olisi edes mahdollista: GGG ei kerro, mitä arkussa oli
> viime tiistaina.
