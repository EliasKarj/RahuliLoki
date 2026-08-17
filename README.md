<div align="center">

# 💰 valuuttaloki

**Path of Exile -varallisuusseuranta, joka kerää itse. Ei nappia jota painaa, ei tiliä
kolmannelle osapuolelle — oma kontti, oma tietokanta.**

Ajastin lukee aarrearkun välilehdet, arvostaa ne poe.ninjan hinnoilla ja piirtää
varallisuuden kertymisen liigan alusta loppuun.

`itse ylläpidetty` · `yksi käyttäjä` · `yksi kontti` · `SQLite`

</div>

---

## Sisältö

- [Mitä tämä tekee](#mitä-tämä-tekee)
- [Käyttöönotto](#käyttöönotto) — työpöytäohjelma, `./start.sh`, Docker tai paikallinen ajo
- [POESESSID ja miksi siihen suhtaudutaan näin](#poesessid-ja-miksi-siihen-suhtaudutaan-näin) — sekä miksi GGG:n OAuth ei tähän käy
- [Pääsynhallinta](#pääsynhallinta) — mitä token suojaa ja miksi palvelin kieltäytyy käynnistymästä
- [Asetukset](#asetukset)
- [Mitä sivu näyttää](#mitä-sivu-näyttää)
- [Miten luvut lasketaan](#miten-luvut-lasketaan)
- [Nopeusrajoitus](#nopeusrajoitus)
- [Hinnoittelu ja nimien selvitys](#hinnoittelu-ja-nimien-selvitys)
- [API](#api)
- [Kehitys](#kehitys)
- [Testit](#testit)
- [Projektin rakenne](#projektin-rakenne)
- [Varmuuskopiot ja liigan vaihtuminen](#varmuuskopiot-ja-liigan-vaihtuminen)
- [Mitä tämä ei tee](#mitä-tämä-ei-tee)

Jokaisen valinnan kohdalla on **▸ Miksi näin** -perustelu: mihin raja-arvo perustuu ja mitä se
ei kerro.

---

## Mitä tämä tekee

Kymmenen minuutin välein taustaprosessi

1. hakee poe.ninjan hinnat (välimuistissa tunnin),
2. lukee aarrearkun välilehdet GGG:n rajapinnasta yksi kerrallaan,
3. arvostaa jokaisen esineen, kertoo pinon koolla ja pudottaa kohinan,
4. kirjoittaa **yhden rivin**: kokonaisarvo chaosina ja divineina, divine-kurssi hetkellä,
   esinemäärä ja välilehtikohtainen erittely.

Selain lukee rivit ja piirtää neljä näkymää. Mitään ei tarvitse painaa: kaavio on ajan tasalla
kun avaat sen viikon tauon jälkeen.

> **▸ Miksi tämä ei ole GitHub Pages -sivu:** kerääjä on prosessi, joka herää kymmenen minuutin
> välein silloinkin kun selain on kiinni. Staattinen sivu voi vain näyttää dataa, jonka joku muu
> on kerännyt — ja se joku muu olisi tässä palvelu, jolle pitäisi luovuttaa tilin tunnus.
> Sivusto ja rajapinta lähtevät samasta kontista samasta portista, joten CORSia tai toista
> osoitetta ei ole.

---

## Käyttöönotto

### Ennen kaikkea muuta: Node ja pnpm

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

### Työpöytäohjelma

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

> **▸ Miksi ikkunan sulkeminen ei lopeta keruuta:** valvomaton keruu on tämän sovelluksen etu
> Exilence Nextiin nähden — se keräsi vain kun ohjelma oli auki. Sulkeminen piilottaa ikkunan
> ilmaisinalueelle ja kerääjä jatkaa. Lopettaminen on erillinen valinta ilmaisinalueen valikossa.

> **▸ Miksi Prisman CLI:tä ei paketoida mukaan:** se on 36 MB alustabinäärejä, joiden ainoa
> tehtävä valmiissa ohjelmassa olisi ajaa kourallinen CREATE TABLE -lauseita kerran
> käynnistyksessä. Migraatiot ajetaan samoista SQL-tiedostoista `node:sqlite`llä, ja CI
> tarkistaa Prismalta itseltään että lopputulos on identtinen. Tämä on myös syy siihen miksi
> Electron 38 on alaraja: sitä vanhemmat pakkaavat Node 20:n, jossa `node:sqlite`ä ei ole.

### Yksi komento (nopein)

```bash
git clone https://github.com/EliasKarj/RahuliLoki.git valuuttaloki
cd valuuttaloki
./start.sh              # macOS, Linux
```

```powershell
git clone https://github.com/EliasKarj/RahuliLoki.git valuuttaloki
cd valuuttaloki
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

### Docker (suositeltu palvelimelle)

```bash
git clone https://github.com/EliasKarj/RahuliLoki.git valuuttaloki
cd valuuttaloki
cp .env.example .env      # täytä POESESSID ja POE_ACCOUNT_NAME
docker compose up -d
```

Sivu on osoitteessa <http://localhost:3000>. Ensimmäinen tilannekuva syntyy seuraavalla
ajastimen herätyksellä, tai heti kun painat sivulta **poll now**.

Compose julkaisee portin vain silmukkaosoitteeseen (`127.0.0.1:3000`), joten tokenia ei
tarvita. Jos muutat tuon `3000:3000`:ksi, aseta myös `AUTH_TOKEN` — muuten palvelin
kieltäytyy käynnistymästä ja kertoo miksi. Ks. [Pääsynhallinta](#pääsynhallinta).

### Fly.io

`fly.toml` on valmiina. Levy pitää luoda ennen ensimmäistä julkaisua, ja tunnus menee
`fly secrets`iin eikä tiedostoon:

```bash
fly launch --no-deploy --copy-config
fly volumes create valuuttaloki_data --size 1 --region arn
fly secrets set POESESSID=… POE_ACCOUNT_NAME='Exile#1234' POE_LEAGUE=Settlers \
  AUTH_TOKEN="$(openssl rand -hex 32)"
fly deploy
```

`AUTH_TOKEN` ei ole tässä valinnainen. Fly julkaisee sovelluksen julkiseen internetiin, ja
palvelin kieltäytyy käynnistymästä ilman sitä. Selain kysyy tokenin kerran ja pitää sen
välilehden ajan.

`auto_stop_machines = false` on tahallinen: nukkuva kone ei kerää mitään, ja kerääminen on
koko sovelluksen tarkoitus.

### Paikallisesti ilman konttia

```bash
pnpm install
pnpm --filter @valuuttaloki/server exec prisma generate
pnpm db:migrate
cp .env.example .env      # täytä tunnukset
pnpm dev                  # palvelin :3000, selainpuoli :5173
```

Vite proxyttaa `/api`-pyynnöt palvelimelle, joten kehityksessäkin puhutaan vain suhteellisiin
osoitteisiin.

---

## POESESSID ja miksi siihen suhtaudutaan näin

`POESESSID` **ei ole rajattu API-avain**. Se on istuntoeväste: sen haltija on kirjautunut
sinuna. Ei kaupankäynnin rajoitusta, ei lukuoikeutta pelkkään arkkuun — koko tili.

Tästä seuraa se, mitä koodi tekee sen kanssa:

| Missä | Mitä tapahtuu |
|-------|---------------|
| Lokit | `registerSecret()` rekisteröi arvon, ja jokainen virhepolku pesee tekstinsä `scrub()`illa. Lisäksi pinon `redact` nollaa `cookie`- ja `authorization`-otsakkeet. |
| Virheilmoitukset | `StashError` pesee viestinsä konstruktorissa. Myös `/api/poll`-vastaus pestään ennen lähetystä. |
| Selain | `/api/config` palauttaa liigan, ajastimen ja kynnysarvot — ei tunnusta. Testi tarkistaa, ettei vastauksessa esiinny edes sanaa `poesessid`. |
| URL | Tunnus kulkee `Cookie`-otsakkeessa eikä koskaan osoitteessa, jossa se päätyisi välityspalvelimen lokiin. |
| Git | `.env` ja `/data` ovat `.gitignore`ssa ensimmäisestä committista alkaen. |

Eväste vanhenee itsestään. Kun se vanhenee, `/api/health` sanoo sen suoraan
(*POESESSID has most likely expired*) sen sijaan että kaavio vain lakkaisi liikkumasta.

> **▸ Miksi kerääjä ei estä käynnistystä ilman tunnusta:** palvelin nousee ilman tunnuksiakin.
> Jo kerätty historia pysyy luettavana, ja `/api/health` kertoo mikä puuttuu. Käynnistymisen
> estäminen veisi kaaviot alas juuri sillä hetkellä kun olet vaihtamassa vanhentunutta
> tunnusta.

### Kyllä, GGG:llä on virallinen OAuth — ja miksi sitä ei käytetä tässä

Tämä on ensimmäinen kysymys jonka kuka tahansa esittää, joten vastaus kuuluu tänne eikä
issueihin.

GGG tarjoaa virallisen OAuth 2.0 -rajapinnan, jossa on `account:stashes`-scope juuri tähän
käyttöön. Se olisi joka mittarilla parempi:

| | POESESSID | OAuth |
|---|---|---|
| Laajuus | **Koko tili.** Kauppa, arkku, viestit | Vain myönnetyt scopet |
| Peruutus | Vaihda salasana | Peru sovelluksen oikeus |
| Vanheneminen | Epämääräinen | Access ~28 pv, refresh ~90 pv |
| Asema | Yksityinen rajapinta | Dokumentoitu ja tuettu |

**Miksi se ei silti käy tähän:** GGG vaatii, että OAuth-sovelluksen redirect URI on HTTPS ja
**rekisteröity verkkotunnus jonka omistat**. IP-osoitteita ja `localhost`ia ei hyväksytä edes
kehityksessä. Lisäksi sovellus pitää rekisteröidä ja saada hyväksytyksi.

Tämä on suorassa ristiriidassa sen kanssa mitä valuuttaloki on. Se sitoutuu oletuksena
silmukkaosoitteeseen, `docker compose` julkaisee portin vain `127.0.0.1`:een, ja koko premissi
on yhden ihmisen itse isännöimä työkalu omalla koneellaan. Sellaisella ei ole verkkotunnusta,
eikä sitä pitäisi tarvitakaan.

Poikkeus on Fly-julkaisu, jolla verkkotunnus on. Jos ajat sitä siellä **ja** saat GGG:ltä
rekisteröinnin läpi, OAuth olisi teknisesti mahdollinen — mutta se ei ole sama sovellus enää:
OAuthin arkkuendpointit ovat eri kuin `character-window/get-stash-items`, joten vastausmuoto,
sivutus ja nopeusrajoitus pitäisi käydä läpi uudelleen.

> **▸ Mitä tästä seuraa sinulle:** kohtele POESESSIDiä salasanana, koska se on sitä. Älä
> liitä sitä issueen, älä kuvakaappaukseen, ja jos epäilet sen vuotaneen, kirjaudu ulos
> kaikilta istunnoilta pathofexile.comilla — se mitätöi evästeen.

> **▸ Tarkkuudesta:** yllä olevat OAuthin yksityiskohdat on luettu toissijaisista lähteistä,
> ei GGG:n dokumentaatiosta suoraan. Tarkista
> [pathofexile.com/developer/docs/authorization](https://www.pathofexile.com/developer/docs/authorization)
> ennen kuin teet päätöksiä niiden varassa — rajapinta on elänyt ja voi elää lisää.

---

## Pääsynhallinta

Tämä sovellus on yhden käyttäjän, mutta *yksi käyttäjä* kertoo kenen **kuuluisi** lukea
dataa — ei kenen on **mahdollista**. Suojattavaa on kolme asiaa: tilin koko varallisuushistoria,
välilehtien nimet, ja `POST /api/poll`, joka kuluttaa tilin GGG-nopeusrajoitusbudjettia
pyynnöstä. Viimeinen on se ikävin: se on juuri se resurssi, jota koko nopeusrajoitin on
olemassa varjelemaan, ja sen loppuun ajaminen johtaa GGG:n aikalisään.

Kolme erillistä porttia, koska ne pysäyttävät kolme eri asiaa:

| Portti | Mitä pysäyttää |
|--------|----------------|
| **Token** | Kenet tahansa, jolla ei ole `AUTH_TOKEN`ia. Vertailu on vakioaikainen, molemmat puolet tiivistetään ensin. |
| **Origin-tarkistus** | Sivun, jolla satut käymään ja joka lähettää `POST /api/poll` selaimesi nimissä. Token ei tässä auta — selain liittäisi sen itse. |
| **Host-tarkistus** | DNS-rebindingin: hyökkääjän verkkonimi osoittaa `127.0.0.1`:een, jolloin selain pitää hänen skriptiään samana originina kuin sinun paneeliasi. |

### Palvelin kieltäytyy käynnistymästä väärässä yhdistelmässä

Yksi asetusyhdistelmä on yksinkertaisesti turvaton: tavoitettavissa koneen ulkopuolelta, eikä
mitään edessä. Siinä tapauksessa `loadConfig` heittää eikä prosessi nouse:

```
refusing to serve an unauthenticated API on 0.0.0.0. This exposes the full wealth history
of the account and a POST /api/poll that spends its GGG rate-limit budget. Set AUTH_TOKEN
(`openssl rand -hex 32`), or bind HOST=127.0.0.1, or set ALLOW_UNAUTHENTICATED=1 if
something in front of it is already authenticating.
```

> **▸ Miksi kaatuminen eikä varoitus:** varoitus lokin rivillä 40 on varoitus, jota kukaan ei
> lue. Ero näiden kahden välillä ei myöskään ole kosmeettinen — toisessa tilin varallisuus on
> julkinen. Kaatuminen käynnistyksessä on ainoa palaute, joka ehtii ajoissa.

> **▸ Miksi `ALLOW_UNAUTHENTICATED` on olemassa:** koska "tavoitettavissa ulkopuolelta" ei aina
> tarkoita "suojaamaton". Compose julkaisee portin `127.0.0.1`:een, Tailscale-liitäntä on
> yksityinen, käänteisproxylla voi olla oma tunnistus. Kontin on silti pakko kuunnella
> `0.0.0.0`:aa ollakseen tavoitettavissa lainkaan. Lippu on kuittaus, ei kytkin: se ei tee
> altistetusta instanssista turvallista.

### `/api/health` vastaa kahdella tavalla

Terveystarkistuksen pitää toimia ennen kuin kukaan on ehtinyt kertoa Dockerille tai Flylle
tokenia, joten se on ainoa reitti tokenin ulkopuolella. Se ei silti kerro kaikkea:

```bash
curl localhost:3000/api/health
# {"status":"up"}

curl -H "Authorization: Bearer $AUTH_TOKEN" localhost:3000/api/health
# {"status":"unconfigured","league":"Settlers","poller":{…},"rateLimit":{…},"prices":{…}}
```

> **▸ Miksi jako:** elävyystarkistus tarvitsee tiedon "vastaako prosessi". Kerääjän
> virheilmoitukset, tilin sijainti GGG:n nopeusrajoittimessa ja hintojen ikä ovat diagnostiikkaa
> nimetystä tilistä. Ne kaksi asiaa eivät kuulu samaan vastaukseen.

### Token selaimessa

Selain kysyy tokenin kerran ja pitää sen `sessionStorage`ssa — se kuolee välilehden mukana.
Token lähtee `Authorization`-otsakkeessa, ei koskaan evästeenä eikä osoitteessa.

> **▸ Miksi ei evästettä:** eväste liitetään automaattisesti myös hyökkääjän sivun
> lähettämään pyyntöön, mikä on koko CSRF-ongelma. Otsake pakottaa esitarkistuksen, jota
> selain ei tee vieraalle originille.

---

## Asetukset

Kaikki `.env`-tiedostossa; `.env.example` on malli.

| Muuttuja | Oletus | Merkitys |
|----------|--------|----------|
| `POESESSID` | — | Istuntoeväste. Pakollinen keräämiseen. |
| `POE_ACCOUNT_NAME` | — | Tilin nimi täsmälleen kuten GGG sen kirjoittaa, `Exile#1234`. |
| `POE_LEAGUE` | `Standard` | Seurattava liiga. Tilannekuvat avaimitetaan tällä. |
| `POLL_CRON` | `*/10 * * * *` | Keräysväli. Tarkistetaan käynnistyksessä, ei vasta ensimmäisellä herätyksellä. |
| `MIN_ITEM_CHAOS` | `2` | Tätä halvemmat *yhteenlasketut* erät jätetään erittelystä pois. |
| `TRACKED_TABS` | tyhjä | Pilkulla erotellut välilehtien nimet. Tyhjä = kaikki. |
| `PRICE_TTL_MINUTES` | `60` | Kuinka vanhaa hintasettiä käytetään ennen uutta hakua. |
| `PRICE_CURRENCY_CATEGORIES` | `Currency,Fragment` | poe.ninjan `currencyoverview`-tyypit. |
| `PRICE_ITEM_CATEGORIES` | ks. alla | poe.ninjan `itemoverview`-tyypit. |
| `POE_NINJA_URL` | `https://poe.ninja/poe1/api/economy/exchange/current` | poe.ninjan API-juuri. Vain jos se siirtyy taas. |
| `POE_CONTACT` | — | Yhteystieto, joka liitetään `User-Agent`iin. |
| `DATABASE_URL` | `file:./data/valuuttaloki.db` | SQLite-tiedosto. |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | HTTP. Oletus on silmukkaosoite, ei kaikki verkkoliitännät. |
| `AUTH_TOKEN` | tyhjä | Jaettu API-token. Pakollinen kun sidos ei ole silmukkaosoite. |
| `ALLOW_UNAUTHENTICATED` | tyhjä | Kuittaus siitä, että joku muu hoitaa tunnistuksen. |
| `ALLOWED_HOSTS` | tyhjä | Sallitut `Host`-otsakkeet tokenittomassa tilassa. |
| `TRUST_PROXY` | tyhjä | Uskotaanko `X-Forwarded-*`. Vain oikean proxyn takana. |
| `PRICE_SET_RETENTION` | `48` | Säilytettävät hintasetit liigaa kohti. `0` = kaikki. Sisältää myös ikonikartan. |
| `REQUEST_TIMEOUT_MS` | `30000` | Yhden ulkoisen pyynnön katto. |
| `LOG_LEVEL` | `info` | pinon taso. |

Oletushintakategoriat: `DivinationCard, Essence, Fossil, Resonator, Scarab, Oil, DeliriumOrb,
Incubator, Artifact, Vial, Omen, Tattoo`.

> **▸ Miksi jalokivet ja kartat puuttuvat oletuksesta:** ne eivät mene nimellä. Jalokiven
> hinta riippuu tasosta, laadusta ja turmeluksesta; kartan tasosta; klusterikorun siitä mitä
> siihen osui. Nimellä arvostaminen antaisi niille jonkin luvun, ja se luku olisi väärä
> tavalla, jota ei kaaviosta huomaa.
>
> **▸ Miksi uniikit ovat mukana, vaikka nekään eivät mene nimellä:** koska niille on olemassa
> oikea avain. poe.ninja palauttaa yhden rivin jokaiselle yhdistelmälle ja kertoo rivillä
> `links` ja `corrupted`; aarrearkun esine kertoo omat pistokkaansa ja turmeluksensa. Avain on
> siis `(nimi, linkit, turmelus)`, ei nimi. Sama Bronn's Lithe on 5 chaosia linkittömänä ja
> 210 kuutoslinkkinä — nimellä arvostettuna toinen niistä olisi ollut väärässä
> nelikymmenkertaisesti.
>
> Erittelyssä ne näkyvät erillisinä riveinä (`Bronn's Lithe`, `Bronn's Lithe (6L)`), koska
> yhteen niputettuna kaavio piilottaisi juuri sen syyn, miksi luku liikkui.
>
> **▸ Mitä tämä ei vieläkään ratkaise:** variantit. poe.ninja erottaa esimerkiksi
> 3.0:aa edeltävän Shavronne's Wrappingsin nykyisestä, eikä aarrekaapin datassa ole mitään
> mikä kertoisi kumpi sinulla on. Kun rivit eroavat vain variantilta, käytetään **halvinta**.
> Molemmat suunnat ovat väärin, mutta yliarvio näkyy kaaviossa tuottona jota ei tullut.

> **▸ Miksi uniikit eivät ole enää mukana:** poe.ninja suunnitteli API:nsa uusiksi, eikä
> hintariveillä ole enää `links`- eikä `corrupted`-kenttää. Ilman niitä varianttia ei voi
> tunnistaa, ja uniikin hinnoittelu pelkällä nimellä valitsisi hiljaa jommankumman: sama
> Bronn's Lithe on ~5 chaosia linkittömänä ja ~210 kuutoslinkkinä.
>
> Vaihtoehdot olivat luku joka on väärässä nelikymmenkertaisesti ilman mitään merkkiä siitä, tai
> ei lukua lainkaan. Uniikit jäävät siis hinnoittelematta ja näkyvät kierroksen "ei hintaa"
> -varoituksessa. Jos poe.ninja alkaa taas julkaista varianttikenttiä, `PRICE_UNIQUE_CATEGORIES`
> kytkee ne takaisin.

---

## Mitä sivu näyttää

Sivu on **loki, ei korttitaulu**. Ei laatikoita eikä reunuksia: hiusviivat erottavat osiot,
ja ainoat asiat joilla on reunat ovat luvut itse.

Ylinnä yksi hallitseva lukema — nettoarvo — ja sarja piirrettynä sen taakse. Lukema on siinä
yksikössä jossa sen sanoisi ääneen: **alle divinen arvoinen arkku chaoksina, sen yli divineinä**,
ja vieressä sen orbin oma kuva. Toinen yksikkö on aina rivin alla, joten mitään ei häviä
vaihdossa.

Sama sääntö koskee **jokaista hintaa sivulla** — taulukon yksikköhintoja ja summia,
kategoriasiruja, muutoksia, tuottoja ja tuntinopeuksia. Sääntö on kirjoitettu yhteen paikkaan
(`formatPrice`) ja divine-kurssi on Reactin kontekstissa, jotta hinnan tulostaminen väärässä
yksikössä vaatisi säännön ohittamista eikä sen unohtamista.

> **▸ Kaksi kohtaa joissa sääntöä ei sovelleta, kummassakin syystä:**
>
> **Divine-kurssi itse** ("205c per divine"). Se *on* muunnos; divineinä se lukisi joka rivillä
> 1.00 eikä kertoisi mitään.
>
> **Kaavioiden akselit.** Per-arvo-sääntö on oikein yksittäiselle luvulle ja väärin akselille:
> akseli jonka jaotus vaihtaisi yksikköä puolivälissä tekisi käyrästä valheen sen omasta
> muodosta. Kaavio valitsee siksi yhden yksikön huippunsa mukaan ja kertoo sen jaotuksessa.

Tukiluvut ovat
sen alla rivinä, hiusviivoin jaettuna. Heti perässä **esinetaulukko**, jossa jokaisen rivin
takana on palkki: rivin osuus suurimmasta omistuksesta. Kaaviot ovat alempana yhden rivin
palkkeina, oletuksena kiinni.

> **▸ Miksi neljä yhtä suurta korttia lähti:** ne antoivat nettoarvolle, tuotolle ja kahdelle
> tuntinopeudelle saman visuaalisen painon. Kukaan ei lue niitä niin: yksi on se luku jonka
> takia sovellus avattiin, loput ovat sen taustaa. Neljä identtistä laatikkoa litistää eron ja
> panee silmän etsimään sitä joka merkitsee.
>
> **▸ Miksi palkit taulukossa:** sata riviä oikealle tasattuja lukuja on vaikea punnita
> keskenään. Palkki tekee arkun muodosta luettavan lisäämättä toista kaaviota katsottavaksi.
> Se skaalataan suurimpaan riviin eikä summaan — summaa vasten kaikki kolmen kärkiomistuksen
> alapuolella olisi liian lyhyt verrattavaksi, mikä on juuri päinvastoin kuin mitä palkilta
> haetaan.

### 1. Nettoarvo ajassa

Chaos pinta-alana vasemmalla akselilla, **divine-kurssi ohuena katkoviivana oikealla**.
Aikaväli 24 h / 7 d / liiga.

> **▸ Miksi kurssi on samassa kaaviossa:** ilman sitä nousevaa chaos-käyrää ei voi erottaa
> divinen inflaatiosta. Jos kurssi nousee 190 → 220 etkä ole tehnyt mitään, chaosina mitattu
> omaisuutesi kasvaa silti. Kaksi akselia rinnakkain tekee eron katsottavaksi.

Piikit merkitään pisteellä: väli, jonka muutos on yli **3× edeltävien liikkuvien välien
mediaani**. Yleensä kauppa tai iso drop.

### 2. Chaos tunnissa

Pylväs jokaisesta peräkkäisten tilannekuvien välistä, normalisoituna tunniksi. Himmeät pylväät
ovat jouten-välejä.

Ylhäällä molemmat luvut: **c/h aktiivinen** ja **c/h seinäkello**.

> **▸ Miksi kaksi lukua:** yön yli nukuttu kahdeksan tuntia ei ole huono farmaustahti, se ei ole
> farmausta lainkaan. Jos jouten-tunnit lasketaan mukaan, luku kutistuu kohti nollaa eikä kerro
> mitään. Jos ne jätetään pois, luku kertoo tahdin *pelatessa* — mutta ei sitä, montako tuntia
> liigaan on oikeasti mennyt. Molemmat, vierekkäin.

### 3. Missä varallisuus on

Pinottu pinta-ala välilehdittäin, ja lajiteltava taulukko tuoreimman tilannekuvan suurimmista
omistuksista.

### 4. Mikä liikkui

Aikavälin päiden erotus esineittäin, ei juokseva summa — juokseva summa toistaisi vain
c/h-kaavion. Voitot ja tappiot näytetään erikseen eikä nettona: *+4000 ja −1000* ja *+3000*
ovat sama netto ja hyvin erilainen ilta.

> **▸ Miksi välilehdet lasketaan yhteen ennen erotusta:** pinon siirtäminen kaatopaikka-
> välilehdeltä valuuttavälilehdelle ei ole tapahtuma. Välilehtikohtainen erotus raportoisi sen
> tappiona yhtäällä ja täsmälleen samansuuruisena voittona toisaalla — kaksi riviä kohinaa
> tapahtumasta jota ei tapahtunut, juuri siinä näkymässä jonka tehtävä on nostaa oikeat
> tapahtumat esiin.

> **▸ Miksi `Why`-sarake on siinä:** omistus jonka määrä ei muuttunut mutta arvo nousi on
> markkina, ei sinä. Ilman erottelua varallisuusseuranta ottaa hiljaa kunnian divinen
> kurssipiikistä. `held` = hankit tai kulutit, `price` = sama määrä eri hintaan, `both` =
> molemmat liikkuivat.

### 5. Esineen historia

Klikkaa nimeä missä tahansa taulukossa. Pinta-ala on kasan arvo, ohut viiva yksikköhinta.
Nouseva pinta-ala tasaisen viivan yllä on sinun ansiotasi; nouseva viiva tasaisen määrän alla
on markkinan.

> **▸ Miksi puuttuva esine on nolla eikä aukko:** myyty kasa kuuluu pudota nollaan. Aukko
> saisi sarjan näyttämään päättyvän, mikä on eri väite.

> **▸ Miksi tämä haetaan vasta klikkauksesta:** se on ainoa reitti joka lukee jokaisen
> erittelyn aikaväliltä — sen sarakkeen, joka on tarkoituksella jätetty pois kaikista muista
> listavastauksista.

### 6. Tilannekuvat

Rivit joista kaaviot on tehty: muutos edelliseen, divine-kurssi hetkellä, hintojen ikä ja
laskettiinko väli aktiiviseksi. Tämä on taulukko, jota luetaan kun kaavio näyttää oudolta.

---

## Miten luvut lasketaan

**Jouten-sääntö.** Jos kahden peräkkäisen tilannekuvan ero on alle **1 chaos**, väli on jouten.
Se ei kartuta aktiivitunteja eikä vaikuta aktiivikeskiarvoon. Näkyy silti kaaviossa himmeänä
pylväänä, koska mittaus tehtiin.

**Paras tunti.** Suurin nousu **minkä tahansa** 60 minuutin ikkunan sisällä, ei "paras
kymmenminuuttinen kerrottuna kuudella". Laskettu monotonisella jonolla, joten epätasainen väli
ei kaada sitä — ja epätasaisia välejä tulee: kontti käynnistyy uudelleen, kone nukkuu, GGG
rajoittaa keräyksen seuraavaan ikkunaan.

**Piikin merkintä.** Liukuva mediaani enintään 12 edeltävästä liikkuvasta välistä. Vähintään
kolme väliä tarvitaan ennen kuin mitään merkitään: kahdesta ei tiedä, miltä tavallinen näyttää.
Jouten-välit jätetään mediaanin ulkopuolelle, muuten mediaani painuisi nollaan ja *kaikki*
merkittäisiin piikiksi.

**Kynnysarvo.** `MIN_ITEM_CHAOS` osuu **yhteenlaskettuun** erään, ei yksittäiseen pinoon.

> **▸ Miksi yhteenlaskettuun:** 900 alteration à 0,12 c on 108 chaosia, vaikka jokainen yksittäin
> alittaa kynnyksen. Ja jos pino on jaettu kymmeneen osaan, pinokohtainen kynnys heittäisi koko
> kasan pois. Kymmenen kertaa 5 alterationia on sama asia kuin viisikymmentä alterationia.

**Esinemäärä** on yksiköitä: 250 chaosin pino on 250 esinettä.

---

## Nopeusrajoitus

GGG bannaa herkästi. Tämä on koodin se osa, jota kannattaa lukea ennen kuin muuttaa mitään.

Jokainen vastaus kertoo voimassa olevan säännön ja oman tilanteen:

```
X-Rate-Limit-Account:       45:60:120,180:3600:3600
X-Rate-Limit-Account-State:  2:60:0,  17:3600:0
```

Kolmikko on `osumat:jakso:rangaistus`. Rajoitin

- **tahdistaa** sen mukaan **paljonko ämpärissä on jäljellä**, ei sen keskimääräisen
  täyttymisnopeuden mukaan: ensimmäinen puolikas budjetista saa kulua vapaasti, ja sen jälkeen
  viive kiihtyy tasaisesti täyteen `jakso / osumat` -vauhtiin siihen mennessä kun ämpäri on
  tyhjä;
- **sarjallistaa** pyynnöt — yksi kerrallaan, ei koskaan rinnakkain;
- **odottaa koko jakson** kun ämpäri on tyhjä, ja ilmoitetun ajan kun tila kertoo rangaistuksesta;
- **kunnioittaa `Retry-Afteria`** 429:ssä ja kaksinkertaistaa siitä 30 minuuttiin asti;
- **luovuttaa** `RateLimitError`illa sen sijaan että jatkaisi hakkaamista.

> **▸ Miksi jäljellä olevan mukaan eikä keskinopeudella:** aiempi sääntö tahdisti *jokaisen*
> pyynnön hitaimman ämpärin keskiarvoon. Tuntisääntö `200:3600` on keskimäärin yksi pyyntö per
> 18 sekuntia, joten kahdenkymmenen välilehden arkku kesti kuusi minuuttia — silloinkin kun
> tuntibudjetista oli käytetty 17/200. Budjetti oli olemassa, me vain kieltäydyimme käyttämästä
> sitä.
>
> Nyt väljä ämpäri ei vaadi mitään. Varannon jälkeen viive kiihtyy tasaisesti, joten katon
> lähestyminen on hidastus eikä seinä. Kovat suojat ovat ennallaan: tyhjä ämpäri odottaa yhä
> koko jaksonsa ja ilmoitettua rangaistusta noudatetaan sekunnilleen.
>
> Säädin on yksi luku, `PACING_RESERVE`. Se on tarkoituksella yksi: se vastaa kysymykseen
> "kuinka lähelle GGG:n kattoa tämä sovellus suostuu ajamaan".

Ensimmäinen kutsu palauttaa välilehtilistan **ja** ensimmäisen välilehden esineet samassa
vastauksessa, joten sitä ei lueta kahdesti.

---

## Hinnoittelu ja nimien selvitys

### poe.ninjan API vaihtui, ja se maksoi jotain

Vanha rajapinta `/api/data/currencyoverview` ja `/itemoverview` avaimitti jokaisen rivin
näyttönimellä. Se on poistettu: koko polku vastaa `not found` jokaiselle liigalle, myös
Standardille, koska osoite on vanhempi kuin poe.ninjan kahden pelin tuki eikä kerro kummasta on
kyse. Tilalla on yksi päätepiste peliä kohti:

```
https://poe.ninja/poe1/api/economy/exchange/current/overview?league=<liiga>&type=<tyyppi>
```

`league` on **GGG:n oma liiganimi sellaisenaan** — `Allflame`, `Hardcore Allflame`.

Rivillä ei ole enää nimeä, ikonia eikä uniikkien varianttikenttiä. Rivi on tunniste ja luku:

```json
{ "id": "alt", "primaryValue": 0.1238 }
```

Kolme seurausta, kaikki menetyksiä:

**Nimet** haetaan nyt toisin päin. Arkun esineen näyttönimestä lasketaan tunniste — ei tunnisteesta
nimeä, koska sitä suuntaa ei voi palauttaa: `assassins-favour` ei kerro mihin heittomerkki
kuului. Erittely näytetään edelleen näyttönimellä, ja se tulee arkusta, mikä on parempi lähde
kuin poe.ninja oli.

**Ikonit** eivät tule enää poe.ninjalta — se julkaisee ne vain chaosille ja divinelle. Ne
otetaan nyt **aarrearkun vastauksesta**, jossa jokaisella esineellä on `icon`-kenttä GGG:n omaan
CDN:ään. Se on parempi lähde kuin poe.ninja koskaan oli: se on juuri sen esineen kuva jota
lasketaan, piirtäjiltä itseltään. Kierros tallettaa näkemänsä hintasettiin, jota ikonihaku lukee
muutenkin, ja kirjoittaa vain kun jotain oli uutta.

**Uniikit** jäävät hinnoittelematta, ks. `PRICE_UNIQUE_CATEGORIES` yllä.

> **▸ Miksi tunnisteissa on kahta lajia ja mitä siitä seuraa:** uudemmat esineet käyttävät
> nimestä johdettua slugia (`accelerating-catalyst`, `awakeners-orb`), mutta vanhemmat valuutat
> käyttävät kauppapaikan lyhenteitä (`alt`, `alch`, `gcp`, `chaos`). Slugin tuottaa sääntö;
> lyhenteitä ei tuota mikään sääntö, joten ne ovat taulukossa `services/ninjaId.ts`.
>
> Taulukkoa **ei voi tarkistaa hintavastauksesta**, koska siinä ei ole nimiä. Siksi virhe on
> muotoiltu näkyväksi: puuttuva lyhenne tarkoittaa että nimi ei osu mihinkään ja esine päätyy
> "ei hintaa" -listaan — näkyvästi hinnoittelematta, ei hiljaa nollaksi. Kierros kirjaa lisäksi
> ne tunnisteet, joita mikään arkussa ei vastannut; juuri siltä puuttuva lyhenne näyttää.
> `verifyAliases` vertaa taulukkoa niihin kahteen nimeen jotka API vielä antaa.

### Näyttönimen valinta arkun esineestä

Arkun esineessä on `name`, `typeLine` ja `baseType`, ja se kumpi niistä on näyttönimi riippuu
esineen lajista:

| Laji | Näyttönimi |
|------|------------|
| Valuutta, sirpaleet, skarabit, essenssit | `baseType` (= `typeLine`) |
| Ennustuskortit | `typeLine` |
| Uniikit | `name` — `baseType` on pohja |

Uniikeilla kokeillaan `name` ensin, muuten `baseType`. Muuten Headhunter arvostettaisiin
nahkavyönä.

Nimien edessä on toisinaan GGG:n merkkaus `<<set:MS>><<set:M>><<set:S>>`; se kuoritaan pois.

**Jokainen hinnoittelematta jäänyt nimi kirjataan lokiin** joka kierroksella, määrineen. Ohitetut
kategoriat (jalokivet, kartat, klusterikorut, tunnistamattomat uniikit) lasketaan erikseen,
jotta tietoinen ohitus ei näytä samalta kuin puuttuva hinta.

> **▸ Miksi hiljainen nolla on pahin vaihtoehto:** esine jota ei osata hinnoitella painuu
> kokonaisarvossa nollaksi. Kaaviossa se näyttää siltä, ettei sitä ole. Loki on se paikka, josta
> aukon näkee — ja aukon näkeminen on ainoa tapa korjata se.

**Jos poe.ninja on nurin** eikä uutta hintasettiä saada, kierros jatkaa edellisellä setillä.
Tilannekuvan `priceSetAt` kertoo, kuinka vanhoilla hinnoilla se arvostettiin, ja
Tilannekuvat-taulukko näyttää sen sarakkeessa **PRICES**. Vasta jos yhtään settiä ei ole, kierros
kaatuu.

---

## API

Kaikki `/api`-alkuiset, kaikki JSONia.

| Reitti | Mitä |
|--------|------|
| `GET /api/snapshots?league=&from=&to=&limit=` | Tilannekuvat vanhin ensin. Erittely mukaan vain `?full=1`; `?tabs=1` antaa välilehtikohtaiset summat ilman esinetason dataa. |
| `GET /api/snapshots/latest?league=` | Tuorein tilannekuva täydellä erittelyllä, välilehtisummilla ja kärkiomistuksilla ikoneineen. 404 ennen ensimmäistä kierrosta. |
| `GET /api/stats?league=&from=&to=` | Tuotto, c/h aktiivinen ja seinäkello, aktiivitunnit, paras tunti, välikohtaiset tiedot. |
| `GET /api/changes?league=&from=&to=&minChaos=` | Mikä liikkui aikavälin päiden välillä: esinekohtaiset muutokset, syy (`quantity`/`price`/`both`), voitot ja tappiot erikseen. |
| `GET /api/item-history?name=&league=&from=` | Yhden esineen määrä ja arvo jokaisessa aikavälin tilannekuvassa. |
| `GET /api/leagues` | Nykyiset liigat GGG:ltä työpöytäversion valikkoa varten. Välimuistissa 6 h; epäonnistuessa pysyvät liigat. |
| `GET /api/account` | Kenelle tallennettu istunto GGG:n mukaan kuuluu, ja täsmääkö se `POE_ACCOUNT_NAME`iin. 502 kun GGG ei suostu vastaamaan — se itsessään on vastaus. |
| `POST /api/poll` | Käynnistää kierroksen ja vastaa **202 heti**, ei kierroksen päätyttyä. 409 jos kierros on jo kesken, 503 jos tunnukset puuttuvat. Lopputulos luetaan `/api/health`istä. |
| `GET /api/health` | Viimeisin onnistuminen, pysäytyksen syy, nopeusrajoituksen tila, hintojen ikä. |
| `GET /api/config` | Liiga, ajastin, kynnysarvot, liigat joilla on historiaa. **Ei POESESSIDiä.** |

Kun `AUTH_TOKEN` on asetettu, jokainen näistä vaatii `Authorization: Bearer …` -otsakkeen
(`X-Auth-Token` käy myös). Ainoa poikkeus on `/api/health`, joka vastaa tokenitta `{"status":"up"}`
ja täydellä diagnostiikalla vasta tunnistettuna — ks. [Pääsynhallinta](#pääsynhallinta).

`/api/health` vastaa **200 aina kun prosessi on pystyssä**, myös pysäytettynä.

> **▸ Miksi ei 503 pysäytettynä:** kontin terveystarkistus käynnistäisi prosessin uudelleen, ja
> uudelleenkäynnistys ei korjaa vanhentunutta POESESSIDiä. Se vain käynnistäisi konttia
> silmukassa päiväkausia. Kentässä `status` lukee `halted`, ja sivun yläreuna sanoo sen ihmiselle.

---

## Kehitys

```bash
pnpm dev            # palvelin + selainpuoli rinnakkain
pnpm dev:server
pnpm dev:web
pnpm db:migrate     # kehitysmigraatio
pnpm db:studio      # Prisma Studio
pnpm build          # selainpuoli ja palvelin
pnpm test
pnpm typecheck
```

Palvelin ajaa TypeScriptiä suoraan Noden tyyppienriisunnalla — käännösvaihetta ei ole
kehityksessä, `tsc` vain tuottaa `dist`in julkaisua varten.

### Uskottavaa dataa ilman odottelua

```bash
pnpm --filter @valuuttaloki/server seed -- --days 4 --league Settlers
```

Kolme päivää tilannekuvia nukkumisjaksoineen, ajelehtivine divine-kursseineen ja satunnaisine
kauppoineen. Kieltäytyy koskemasta liigaan, jolla on jo tilannekuvia, ellei anna `--force`.

> **▸ Miksi tämä on olemassa:** kaavioiden arvioiminen vaatii dataa, jolla on oikean datan muoto.
> Kolmen vuorokauden odottaminen sen selvittämiseksi, että työkaluvinkki menee akselin päälle,
> ei ole työtapa.

---

## Riippuvuuksien tarkistus

CI ajaa `pnpm audit --audit-level moderate` ja kaataa käännöksen tunnettuun haavoittuvuuteen.
Yksi neuvonta on ohitettu, `package.json`in `pnpm.auditConfig.ignoreGhsas`issa:

**[GHSA-jmr9-qjv8-65gv](https://github.com/advisories/GHSA-jmr9-qjv8-65gv)** — `extract-zip`,
validoimaton symlinkkien polkuhyppäys purettaessa. Korjattua versiota **ei ole olemassa**
(`Patched versions: <0.0.0`); paketti on ylläpitämätön.

> **▸ Miksi tämä on hyväksyttävä poikkeus:** `extract-zip` tulee Electronin *asennusskriptin*
> mukana, ja sen ainoa tehtävä on purkaa Electronin oma binääri kehittäjän koneella. Se ei ole
> mukana julkaistussa ohjelmassa, sitä ei aja mikään tämän repon koodi, eikä se pura mitään
> muuta kuin Electronin oman GitHub-julkaisun. Haavoittuvuus edellyttää vihamielistä
> zip-tiedostoa, jollaista tässä ketjussa ei ole.
>
> Ohitus on nimenomaisesti tuossa yhdessä paikassa eikä kynnysarvoa laskemalla, jotta se on
> yhden rivin muutos diffissä eikä kokonaisen portin hiljainen sammuttaminen.

---

## Testit

```bash
pnpm test
```

**457 testiä**, ei yhtään verkkopyyntöä:

- **Nopeusrajoitin** — otsakkeiden jäsennys, tahdistus, sarjallistuminen, `Retry-After`,
  kaksinkertaistuminen kattoon asti. Kello ja uni ovat väärennettyjä, joten 30 minuutin
  perääntymisen testaaminen kestää mikrosekunteja.
- **Hinnat** — nauhoitetut poe.ninja-vastaukset, myös rikkinäiset: null-hinta, tyhjä
  `lines`, HTML JSONin sijaan.
- **Arkku** — nauhoitetut GGG-vastaukset merkkauksineen. Yhden välilehden kaatuminen kaataa
  kierroksen; tunnus ei vuoda virheilmoitukseen.
- **Arvostus** — nimien selvitys, pinojen yhdistäminen, kynnysarvo, ohitetut kategoriat.
- **Sarjat** — jouten-sääntö, epätasaiset välit, piikin merkintä, paras tunti.
- **Kerääjä** — mitään ei kirjoiteta kun jokin kaatuu; perääntyminen; pysäytys kolmen jälkeen;
  käsin ajo purkaa pysäytyksen.
- **API** — jokainen reitti `app.inject()`illa väärennetyllä varastolla.
- **Selainpuoli** — muotoilusäännöt, kaavioiden muodonmuutokset, ja esinetaulukon niputus
  välilehtien yli, haku ja lajittelu.
- **Kirjautuminen** — että anonyymi eväste *ei* kelpaa istunnoksi, että GGG:n myöhemmin
  antama kelpaa, ettei samaa evästettä kysytä GGG:ltä joka kierroksella, ja että odotus
  loppuu aikakatkaisuun eikä jää polkemaan.

---

## Projektin rakenne

```
/server
  /src
    /services   priceService, stashService, valuationService, uniques, snapshotRepo
    /routes     snapshots, health, config
    /jobs       pollJob
    /lib        rateLimiter, logger, series, changes, config, auth, http
    app.ts      Fastifyn kokoaminen (testattavissa ilman kuuntelevaa porttia)
    index.ts    käynnistys, ajastin, staattinen sivusto
  /prisma       schema.prisma + migraatiot
  /tools        seed.ts
/desktop
  /src          main (Electron), login (kirjautumisikkuna), settings, preload
/scripts        with-env.mjs (lataa juuren .env Prisma CLI:lle)
/web
  /src
    /components NetWorthChart, RatePerHourChart, TabBreakdown, SnapshotTable, PollerStatus,
                TokenGate, ChangesTable, ItemHistory, ItemIcon
    /hooks      useSnapshots
    /lib        api, format, series
```

Tilastot lasketaan palvelimella ja tulevat selaimeen valmiina. Jouten-sääntö ja piikkien
merkintä ovat siis olemassa **tasan yhtenä toteutuksena** — kaksi rinnakkaista ehtisi erkaantua
toisistaan ensimmäiseen muutokseen mennessä.

---

## Varmuuskopiot ja liigan vaihtuminen

Tietokanta on yksi tiedosto, ja rivejä vain lisätään — mitään ei päivitetä eikä poisteta.

```bash
docker compose stop
docker compose cp valuuttaloki:/data/valuuttaloki.db varmuuskopio.db
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

---

## Mitä tämä ei tee

- **Ei useita käyttäjiä, ei kirjautumista, ei jakamista.** Yksi käyttäjä, yksi GGG-tili.
- **Ei kolmansien osapuolten sivustojen kaapimista.** GGG ja poe.ninja suoraan.
- **Ei PoE2-tukea.** GGG ei tarjoa julkista PoE2-arkkurajapintaa. Liiga-asetus ei sulje ovea,
  mutta mitään ei ole rakennettu sen varaan.
- **Ei kaupankäyntiä, craft-laskureita eikä flippityökaluja.**

Varhaisen liigan hinnat heiluvat rajusti, koska markkinaa ei vielä ole. Kaavion heilunta
ensimmäisinä päivinä ei ole varallisuuden liikettä vaan poe.ninjan epävarmuutta.

---

## Lisenssi

MIT.
