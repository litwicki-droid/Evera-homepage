# Everas hemsida: publicera utan serverkommandon

Hemsidan består av 20 statiska filer. Verktyget använder enbart SFTP, inte SSH-kommandon på servern. Python och OpenSSH-klienten som redan finns på GitHubs Ubuntu-runner räcker. Inga Pythonpaket installeras.

Inget är publicerat genom att lägga dessa filer i repot. Workflowen startar bara när du väljer **Run workflow**. Börja med `check`, fortsätt med `preview` och använd `production` först när rätt fjärrmapp och backup är bekräftade.

## Förbered en gång

1. Lägg webbplatsens innehåll i repots rot. `.github` och `deploy` ska ligga bredvid `index.html`.
2. Lägg workflowfilen på grenen `main`. GitHub visar inte manuell workflow-dispatch förrän workflowen finns på repots standardgren. Den här lösningen förutsätter att standardgrenen är `main`.
3. Hämta exakt SFTP-värd, användarnamn och port från one.coms kontrollpanel. Bekräfta att SFTP och lösenordsinloggning är tillgängliga för kontot. FTP/FTPS är inte samma protokoll och stöds inte här.
4. Bekräfta den absoluta webbrotens sökväg i SFTP, inte bara i webbfilhanteraren. `SFTP_REMOTE_DIR` är avsiktligt tom tills den är verifierad. Gissa inte `/www`, `/public_html` eller någon annan mapp. Verktyget kräver en befintlig undermapp under `/`, med enkla filnamn utan mellanslag. Om webbplatsen faktiskt ligger direkt i SFTP-roten `/` behöver koden granskas och anpassas innan användning.
5. Skaffa serverns offentliga SSH-värdnyckel och kontrollera dess fingerprint mot en betrodd uppgift från one.com/support. Lägg sedan en korrekt `known_hosts`-rad i hemligheten nedan. Enbart `ssh-keyscan` mot samma nätverksanslutning bevisar inte serverns identitet. Verktyget använder aldrig automatisk acceptans av nycklar. Om nyckeln byts måste den nya identiteten verifieras innan hemligheten uppdateras.
6. Behåll en privat säkerhetskopia av den nuvarande webbplatsen, exempelvis `www.zip`. Lägg inte zip-filen i repot, inte ens om repot är privat. Kontrollera med `git status` innan första commit; `.gitignore` tar inte bort filer som redan spåras.

### GitHub-inställningar

Öppna repot → **Settings → Secrets and variables → Actions**.

Under **Secrets**, skapa:

| Namn | Innehåll |
| --- | --- |
| `SFTP_HOST` | Verifierad SFTP-server från one.com, bara värdnamn |
| `SFTP_USER` | Kontots SFTP-användarnamn |
| `SFTP_PASSWORD` | SFTP-lösenordet, utan radbrytning |
| `SFTP_KNOWN_HOSTS` | Betrodd komplett known_hosts-rad: värdnamn, nyckeltyp, offentlig nyckel. För annan port än 22 används normalt `[värd]:port` som värdfält. |

Under **Variables**, skapa:

| Namn | Innehåll |
| --- | --- |
| `SFTP_REMOTE_DIR` | Verifierad absolut webbrot, utan avslutande snedstreck |
| `SFTP_PORT` | Verifierad port, annars används 22 |
| `PRODUCTION_ENABLED` | Låt vara tomt eller `false` tills produktion får användas. Endast exakt `true` öppnar spärren. |

Workflowen använder read-only-behörighet för repot och sparar inte checkout-token i Git. Alla lägen har samma kögrupp, utan automatisk avbrytning av pågående körning. GitHub kan ändå ersätta en äldre väntande körning med en ny, och en användare kan avbryta manuellt. Kön skyddar bara körningar i detta repo, inte ändringar via one.com eller andra repos.

`actions/checkout` är låst till `11bd71901bbe5b1630ceea73d27597364c9af683` (v4.2.2), verifierad mot GitHubs API den 2 november 2026. Det låser koden, men innebär inte att versionen är den senaste. Uppdatera bara efter ny granskning och SHA-verifiering. Runnerns Python och OpenSSH följer GitHubs Ubuntu-image och är inte låsta här.

## Vardagsguiden

**Kontrollera anslutningen:** Gå till **Actions → Evera SFTP → Run workflow**. Välj `main` och `check`. Körningen läser fjärrmappar och kontrollerar att relevanta befintliga filer inte är länkar eller fel filtyp. Den skapar eller ändrar inget på servern. Den testar inte skrivbehörighet eller att rätt domän pekar på mappen; det måste verifieras separat.

**Testa hemsidan:** Välj `preview`. Verktyget skapar en unik `evera-preview-<slumpvärde>` under den verifierade webbroten och laddar upp exakt manifestets 20 filer där. Målsökvägen skrivs i körningens logg. Om webbroten är rätt och mappen är åtkomlig kan du normalt öppna motsvarande adress under `https://evera.care/`. Kontrollera själv sambandet, ingen URL gissas av koden. Preview är inte lösenordsskyddad: den kan vara publikt tillgänglig. Canonical- och delningslänkar pekar fortfarande på liveadressen. Rensa senare gamla preview-mappar manuellt efter kontroll; verktyget raderar dem aldrig.

**Publicera live:** Kontrollera backup, godkänn preview, sätt repo-variabeln `PRODUCTION_ENABLED=true`. Välj `main`, `production` och skriv exakt `PUBLISH evera.care` i bekräftelsefältet. Stäng gärna variabeln igen efteråt. Verktyget ersätter bara de 20 namngivna webbplatsfilerna. Andra filer, inklusive serverinställningar, lämnas kvar. Avsikten ska vara granskad före körningen: den här workflowen lägger inte till ett separat godkännandesteg i GitHub Environments.

**Gör en vanlig ändring:** Ändra HTML, CSS eller JavaScript i repot. Kör lokala tester, granska diffen och lägg ändringen på main. Kör sedan preview och slutligen production. Bara de 20 filerna i `deploy/manifest.json` publiceras. Ändras filuppsättningen krävs en medveten ändring av manifestet och granskning av antalskontrollen. `deploy/original-sha256.json` dokumenterar den ursprungliga kopian; den är inte en spärr mot framtida innehållsändringar.

## Lokala kontroller utan konto

Kör från repots rot:

```sh
python3 -m unittest discover -s deploy -p 'test_*.py' -v
python3 deploy/publish.py --dry-run
```

Dry-run kontrollerar den lokala fillistan och gör inga nätverksanrop. Mocktesterna simulerar SFTP; de bevisar inte att one.coms server stöder listformat, rättigheter eller namnbyte över befintliga filer. Inga verkliga servertester är gjorda i denna leverans.

## Vad skydden gör och inte gör

Manifestet tillåter exakt 20 filer. Varken README, deploykoden, privata zip-filer eller GitHub-konfiguration skickas till webbhotellet. Källfiler och deras lokala föräldramappar får inte vara symboliska länkar. Fjärrmapparnas föräldrar och målfilernas typer kontrolleras genom SFTP-listning, även igen under publiceringen. Okänt listformat stoppar körningen hellre än att gissas.

Varje fil laddas först upp under ett unikt tillfälligt namn i målmappen och får sedan sitt riktiga namn genom SFTP `rename`. `index.html` kommer sist. Det minskar risken för en halvskriven enskild fil, men hela sajten byts inte atomiskt: besökare kan tillfälligt få en blandning av gammalt och nytt. Servern måste stödja namnbyte över en befintlig fil; om den inte gör det avbryts körningen utan att verktyget först raderar originalet. Ingen delete-fallback finns.

Inga filer raderas, inte heller tillfälliga filer efter ett fel. Avbruten körning kan lämna en delvis uppdaterad sajt och `.evera-upload-*`-filer. Kontrollera läget innan du kör igen. Ett enskilt SFTP-anrop får högst 120 sekunder; workflowen har en totalgräns på 30 minuter. Rå serveroutput skrivs inte till loggen. Felmeddelandet kan därför inte alltid skilja mellan fel nyckel, fel lösenord och nekad behörighet.

OpenSSH får lösenordet från miljön via `SSH_ASKPASS`, aldrig i kommandoradsargument eller batchkommandon. Miljön innehåller fortfarande en hemlighet medan jobbet körs. Ge inte obetrodd kod tillgång till samma runner eller hemligheter. Endast lösenordsinloggning stöds; ingen privat SSH-nyckel eller keyboard-interactive används. Använd bara ett granskat, betrott branchinnehåll när repohemligheter är tillgängliga. Produktion är spärrad utanför main, men preview/check kan väljas på andra grenar och deras kod kan komma åt SFTP-hemligheterna. Begränsa vem som får skriva till repot och starta Actions.

SFTP-klienten kan inte låsa serverns filsystem eller göra atomiska lstat-och-rename-kontroller. En annan skrivare kan byta en mapp eller fil till en länk mellan kontroll och användning. Skyddet mot befintliga länkar är därför inte en garanti mot en illvillig samtidig skrivare. Låt ingen annan ändra målträdet under körningen. Servern och kontot måste vara betrodda. Bekräfta också att serverns listning visar dolda filer och länkar korrekt.

## Återställ från privat www.zip

Detta är en manuell återställning, inte en automatisk rollback. Packa upp din betrodda backup i en privat separat mapp, inte direkt över repot. Kontrollera arkivets sökvägar före uppackning och undvik arkiv med absoluta sökvägar, `..` eller länkar. Kontrollera sedan vilka filer som ligger direkt i den verkliga webbroten; backupen kan ha en extra `www/`-nivå.

För att återställa just manifestets 20 webbplatsfiler kan du kopiera motsvarande ordinarie filer från den privata backupen till repots webbplatsrot, granska diffen och köra lokala tester, preview och production igen. Skapa gärna en särskild restore-commit så att återställningen går att följa. Kopiera inte in zip-filen eller hemligheter. Om backupen har en annan filuppsättning, serverkonfiguration eller fler filer måste återställningen göras manuellt via one.coms filhanterare/SFTP efter separat granskning. Den här publiceringen återställer inte sådana filer och tar inte bort nya extrafiler. Behåll backupen tills du verifierat sidan i webbläsaren.

## Hitta SFTP-mappen utan att gissa

Läget `discover` listar bara posterna i SFTP-roten. Det behöver inte SFTP_REMOTE_DIR och ändrar inga fjärrfiler. Använd listan tillsammans med kontrollpanelen och en jämförelse med backupen för att verifiera webbplatsens riktiga mapp.

## Verifierad One.com-koppling (2 november 2026)

SFTP_REMOTE_DIR är /customers/1/7/f/coohcizea/webroots/9f2a08c7. Den är verifierad genom domänkopplingen evera.care_ i SFTP och matchning av startsidans SHA256 mot den privata File Manager-backupen samt publika hemsidan. Använd inte /www-genvägen. Värdnyckeln matchades mot DNSSEC-signerad SSHFP.

Preview-körning #9 laddade upp 20 filer till https://evera.care/evera-preview-9f5503b915754346842bc9049f9a3c70/. Full HTTP-hashkontroll är inte avslutad eftersom servern svarade med tillfällig 429-begränsning efter tio godkända filer. Browserkontroll visade laddade typsnitt, fem script och spelande MP4-film. Ljudknappen växlade tillstånd; faktisk hörbar kvalitet kräver mänsklig kontroll. Ingen produktion är utförd.

Överföringen är långsam på denna tjänst eftersom sökvägar kontrolleras upprepade gånger. Låt pågående körning få slutstatus före nytt försök. Vid avbrott kan en partiell preview-mapp och tillfälliga .evera-upload-filer finnas kvar. Radera inte andra filer.
