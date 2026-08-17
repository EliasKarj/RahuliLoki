# Mitä sivu näyttää

Ulkoasu, näkymät ja se miten luvut lasketaan.

[← back to the README](../README.md)

---

Sivu on **loki, ei korttitaulu**. Ei laatikoita eikä reunuksia: hiusviivat erottavat osiot,
ja ainoat asiat joilla on reunat ovat luvut itse.

### Ulkoasu: Citadel at the End of Time

Tyhjyys joka ei ole aivan musta, kulta joka on ainoa valo siinä, ja violetti joka on aika
itse. Nimike on leveään harvennettuja versaaleja päätteellisellä kirjasimella — kaiverrettu,
ei ladottu — ja nettoarvon luvun takana palaa hiipuva hehku.

| Rooli | Väri | Missä |
|-------|------|-------|
| **kulta** | `#e2a94f` | chaos ja kaikki varallisuus: nettoarvo, summat, nousut |
| **violetti** | `#9d7bf0` | divine: kurssikäyrä ja divineinä ilmoitetut sarjat |
| **tomu** | `#7a6f92` | se mikä tapahtui muttei liikuttanut lukua: tyhjät välit, tappiot |
| **tyhjyys** | `#070610` | tausta, jossa on violettia sen verran ettei se ole neutraali |

> **▸ Miksi tappiot eivät ole punaisia:** suunta luetaan jo etumerkistä. Punainen olisi kolmas
> sävy asialle joka on jo erotettavissa, ja varaisi värin merkitykseen jota mikään muu kohta
> sivulla ei käytä.
>
> **▸ Miksi kaavioiden värit ovat omassa tiedostossaan:** Recharts ottaa värit propseina eikä
> luokkina, joten jokainen kaavio kantoi ennen omaa kopiotaan `#e0a458`:sta — kuusi tiedostoa
> jotka olivat samaa mieltä sattumalta. Ne lakkasivat olemasta samaa mieltä sinä hetkenä kun
> paletti vaihtui. Nyt värit ovat `web/src/lib/palette.ts`:ssä, ja paletti on kaksi tiedostoa
> kahdeksan sijaan.
>
> **▸ Miksi taustan hehkut ovat noin himmeitä:** niiden alla on ruudullinen pieniä lukuja.
> Mikä tahansa niin voimakas että sen huomaisi suoraan olisi myös niin voimakas että luvut
> lukisi sen läpi.

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

Ylärivillä, tilan ja **kerää nyt** -napin välissä, juoksee **laskuri seuraavaan automaattiseen
kierrokseen**: `next poll in 4:07`. Kun kierros on käynnissä, siinä lukee sen sijaan
`polling now`, ja kun automaattista keruuta ei ole (tunnukset puuttuvat tai kerääjä on
pysäytetty), laskurin paikalla lukee syy.

> **▸ Miksi aika kysytään ajastimelta eikä lasketa cron-lausekkeesta uudelleen:** toinen
> jäsennin voi olla eri mieltä sen kanssa joka oikeasti pitää kelloa, ja laskuri joka on eri
> mieltä ajastimen kanssa on huonompi kuin ei laskuria lainkaan. Palvelin kysyy node-cronilta
> sen omat seuraavat herätykset ja valitsee ensimmäisen, joka ei osu perääntymisjaksoon —
> epäonnistuneen kierroksen jälkeen herätys **ohitetaan** eikä siirretä, joten "seuraava
> herätys" ja "seuraava keruu" ovat eri kysymyksiä.

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
