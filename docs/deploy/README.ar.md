# نشر DeepCode Studio مجاناً — دليل خطوة بخطوة

آخر تحديث: 2026-11-15. الخدمات المجانية تتغيّر كثيراً؛ إن اختلف شيء عمّا هنا فالمرجع صفحة أسعار الخدمة نفسها.

## الصورة العامة

| الجزء | أين | مجاني؟ | الحدود المهمة |
|---|---|---|---|
| الكود + الفحص + بناء المثبّتات | GitHub (مستودعان عامّان) | نعم، دقائق Actions غير محدودة للمستودعات العامة | المستودع العام يقرؤه الجميع؛ الأسرار تبقى في GitHub Secrets |
| تحميل المثبّتات | GitHub Releases | نعم | — |
| الخادم (البوابة + الموقع + لوحة الإدارة) | Render — خدمة ويب واحدة (حاوية Docker) | نعم، بلا بطاقة | 512MB ذاكرة، 0.1 معالج، 750 ساعة/شهر، **ينام بعد 15 دقيقة خمول** (نوقظه كل 10 دقائق من GitHub) |
| قاعدة البيانات | Neon (Postgres) | نعم، بلا بطاقة | 1GB تخزين، 100 ساعة حوسبة/شهر، تنام بعد 5 دقائق خمول |
| Redis | Redis Cloud | نعم، بلا بطاقة | 30MB، 30 اتصالاً، ~100 عملية/ثانية |
| البريد (تأكيد الحساب، استعادة كلمة المرور) | Brevo SMTP | نعم | 300 رسالة/يوم |
| إشعار الدفع على هاتفك | تطبيقك smm (Firebase نفسه) | نعم | — |
| الدفع | رمز UPI QR (PhonePe وغيره) + موافقتك من الهاتف | بلا رسوم | التحقق يدوي: أنت من يؤكد وصول المال |

**بصراحة:** هذا يكفي للتجربة وأول المستخدمين. الخادم المجاني بطيء (0.1 معالج)، وقد يتأخر أول طلب بعد النوم حتى دقيقة إن فات إيقاظه. عندما يأتي أول دخل، الانتقال إلى خطة Render المدفوعة الأرخص أو خادم VPS صغير لا يحتاج أي تغيير في الكود: نفس الصورة `infra/render/Dockerfile`.

Vercel المجاني (Hobby) **غير مسموح** للمشاريع التجارية، ولهذا لم نستخدمه.

## كيف يعمل الدفع

1. المستخدم يختار باقة في `/dashboard/billing` ← تظهر صفحة فيها رمز QR بمبلغ ثابت ومرجع قصير (مثل `DC7K2M9QXP`).
2. يدفع بأي تطبيق UPI، ثم يكتب رقم **UTR** (12 رقماً من تفاصيل العملية) ويضغط «دفعت — إرسال».
3. يصلك إشعار على هاتفك في تطبيق Hajzy admin: «DeepCode: new UPI payment ₹… · UTR …».
4. تفتح تبويب **DeepCode** في التطبيق، تتأكد في PhonePe/البنك أن المبلغ نفسه ورقم UTR نفسه وصلا، ثم تضغط **«وصل المال — موافقة»**. تُفعَّل الباقة فوراً (30 يوماً، والأيام المتبقية من الباقة نفسها تُضاف). أو **رفض** مع سبب يراه المستخدم.
5. بديل للهاتف: `/admin/payments` في الموقع.

لا يوجد خصم تلقائي ولا تجديد تلقائي: عند انتهاء الشهر يدفع المستخدم مجدداً بنفس الطريقة.

**تنبيه عن UPI:** الحساب الشخصي في UPI له حدود يومية وقد تُعامل الدفعات التجارية المتكررة عليه بحذر. الأفضل فتح **PhonePe Business** (مجاني) واستخدام عنوان UPI التجاري (VPA) الخاص به.

---

## الخطوات

### 1) GitHub — مستودعان عامّان

- `deepcode-studio`: هذا المجلد (الخادم، الموقع، قاعدة البيانات، الوثائق).
- `deepcode-desktop`: مجلد `apps/desktop` (تطبيق سطح المكتب). هو مستودع git مستقل لأنه نسخة معدّلة من ZCodium (Apache-2.0). يُرفع **بتاريخه كما هو** (فرع `deepcode/rebrand` يصبح `main`) لأن مزامنة تحديثات ZCodium الأسبوعية تعتمد على هذا التاريخ — التفاصيل في `apps/desktop/docs/upstream-sync.md`.

قبل الرفع: تأكد أن `.env` و`infra/render/secrets.env` غير مرفوعين (موجودان في `.gitignore`).

### 2) قاعدة البيانات — Neon

1. أنشئ حساباً على neon.com ← مشروع جديد، المنطقة **AWS Asia Pacific (Singapore)**.
2. انسخ **Connection string** (يبدأ بـ `postgresql://` وينتهي بـ `?sslmode=require`).
3. من جهازك، داخل هذا المجلد، أنشئ الجداول والباقات (مرة واحدة):

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.3/bin:$PATH
```

```bash
DATABASE_URL='postgresql://…' pnpm db:migrate
```

```bash
DATABASE_URL='postgresql://…' KEY_HASH_PEPPER='<من secrets.env>' POOL_KEY_ENCRYPTION_KEY='<من secrets.env>' SEED_PRODUCTION=1 pnpm db:seed
```

`SEED_PRODUCTION=1` يُنشئ الباقات بالروبية (أسعار مؤقتة: 499 / 1499 / 3999) دون حسابات تجريبية، ولا يغيّر الأسعار إن أعدت تشغيله. تعدّل الأسعار لاحقاً من `/admin/plans`.

### 3) Redis — Redis Cloud

1. حساب على redis.io ← **Free** database، أقرب منطقة (AWS ap-south-1 Mumbai أو Singapore).
2. من صفحة القاعدة: Public endpoint + كلمة مرور المستخدم `default`.
3. `REDIS_URL=redis://default:<password>@<endpoint>:<port>`

### 4) البريد — Brevo

1. حساب على brevo.com ← SMTP & API ← أنشئ SMTP key.
2. `SMTP_URL=smtps://<login>:<smtp-key>@smtp-relay.brevo.com:465`
3. `MAIL_FROM` بريد تحققت منه في Brevo.

### 5) الأسرار

```bash
infra/render/gen-secrets.sh
```

يكتب `infra/render/secrets.env` (لا يطبع القيم). **احفظ نسخة منه في مكان آمن**: ضياع `POOL_KEY_ENCRYPTION_KEY` يعني أن مفاتيح OpenCode المخزّنة لا تُقرأ، وضياع `KEY_HASH_PEPPER` يُبطل كل مفاتيح المستخدمين.

### 6) Firebase — لإشعار هاتفك وموافقتك

استخدم مشروع Firebase نفسه الذي يعمل عليه تطبيق smm. انسخ من `smm/.env.local` القيم:
`FIREBASE_ADMIN_PROJECT_ID` و`FIREBASE_ADMIN_CLIENT_EMAIL` و`FIREBASE_ADMIN_PRIVATE_KEY`.
الإشعار يُرسل إلى موضوع `admins` نفسه الذي يشترك فيه التطبيق، والموافقة تُقبل فقط من حساب `role: admin` في Firestore.

### 7) Render — الخادم

1. حساب على render.com (دخول بـ GitHub).
2. **New → Blueprint** ← اختر مستودع `deepcode-studio`. سيقرأ `render.yaml` ويطلب القيم المعلّمة.
3. أدخل: `DATABASE_URL`، `REDIS_URL`، قيم `secrets.env` الخمس، `UPI_PAYEE_VPA` (عنوان UPI الخاص بك)، قيم Firebase الثلاث، `SMTP_URL`، `MAIL_FROM`.
4. لـ `APP_URL` و`GATEWAY_PUBLIC_WEB_ORIGIN` و`NEXT_PUBLIC_GATEWAY_URL` ضع مؤقتاً `https://deepcode.onrender.com`، وبعد أول نشر استبدلها بالعنوان الحقيقي الذي يعطيك إياه Render، ثم **Manual Deploy**.
5. تحقق: `https://<عنوانك>/healthz` يعيد `{"ok":true}`، و`https://<عنوانك>/ar` يفتح الموقع.

### 8) حسابك كمدير

1. سجّل في الموقع ببريدك وأكّده.
2. في Neon → SQL Editor:

```sql
update users set role = 'admin' where lower(email) = lower('بريدك@example.com');
```

3. سجّل الخروج والدخول، ثم من `/dashboard/settings` فعّل التحقق بخطوتين (مطلوب لدخول `/admin`).
4. أضف مفتاح OpenCode Go بإحدى الطريقتين: `OPENCODE_GO_API_KEYS=oc_sk_...` في بيئة الخادم (تُضاف تلقائياً عند الإقلاع)، أو من `/admin/pool` (يُحفظ مشفّراً ولا يظهر مرة أخرى).
   ثم شغّل `pnpm db:go-free` مرة واحدة لضبط الخطة المجانية والنموذجين `hy4-flash-free` و`deepseek-v4.1-flash`.
5. **النماذج والخطط** (التفاصيل في [MODELS.ar.md](MODELS.ar.md)):
   - `/admin/providers` ← «مزامنة النماذج الآن» لـ OpenCode Go: يجلب القائمة الحيّة بأسمائها وأسعارها وسياقها.
   - `/admin/models` ← لكل نموذج: حدّد الخطط التي تعرضه، وعدّل سعرك، أو أخفِه. أو «إضافة جماعية» لكل النماذج المجانية إلى خطة.
   - `/admin/plans` ← عدّل أسعار الخطط ورصيدها وحدودها.

### 9) إبقاء الخادم مستيقظاً

في مستودع `deepcode-studio` على GitHub: Settings → Secrets and variables → Actions → **Variables** ← `DEEPCODE_PUBLIC_URL = https://<عنوانك>`. ملف `keepalive.yml` يرسل طلباً كل 10 دقائق. (GitHub يوقف الجدولة في المستودعات العامة بعد 60 يوماً بلا commits؛ أعد تفعيلها من تبويب Actions عند الحاجة.)

### 10) تطبيق الهاتف (smm)

ابنِ التطبيق مع عنوان الخادم:

```bash
cd /home/mohammed/Desktop/smm/mobile_admin && flutter build apk --release --dart-define=DEEPCODE_API_BASE_URL=https://<عنوانك>
```

ثبّت الـ APK. يظهر تبويب **DeepCode** في الأسفل، والضغط على إشعار دفع DeepCode يفتحه مباشرة.

### 11) تطبيق سطح المكتب — Linux وWindows وmacOS

في مستودع `deepcode-desktop`: Settings → Variables:

- `DEEPCODE_GATEWAY_URL = https://<عنوانك>`
- `DEEPCODE_WEB_ORIGIN = https://<عنوانك>`

ثم أنشئ وسم إصدار:

```bash
cd apps/desktop && git tag v0.1.0 && git push deepcode v0.1.0
```

سير العمل `deepcode-desktop.yml` يفحص ثم يبني: Linux (x64/arm64: AppImage + deb)، Windows x64، macOS (Apple Silicon + Intel)، وينشرها في **Releases** مع `SHA256SUMS.txt`. البناء الكامل يستغرق قرابة ساعة.

بعدها سجّل كل ملف في `/admin/releases` (الرابط من GitHub Release + قيمة SHA-256 من `SHA256SUMS.txt` + الحجم) حتى يظهر في صفحة التحميل.

**بدون شهادات توقيع (مدفوعة):**
- **Windows:** تظهر شاشة SmartScreen ← «More info» ← «Run anyway».
- **macOS:** يرفض فتحه أول مرة ← System Settings → Privacy & Security ← «Open Anyway» (أو `xattr -cr "/Applications/DeepCode Studio.app"`). التحديث التلقائي على macOS يحتاج توقيعاً، فالتحديث هناك يدوي.
- **Linux:** يعمل مباشرة (`chmod +x` للـ AppImage).

---

## ما يجب أن تعرفه قبل الإطلاق

- **ملفات المهارات المرفوعة من لوحة الإدارة** تُحفظ على قرص Render المؤقت وتضيع عند إعادة التشغيل في الخطة المجانية. أعد رفعها بعد كل نشر، أو أجّل هذه الميزة حتى تنتقل لخطة مدفوعة.
- **الحدود الحقيقية:** عشرات المستخدمين المتزامنين على الأكثر. Redis Cloud المجاني يحد بـ ~100 عملية/ثانية.
- **الأسعار والنصوص القانونية** ما زالت مؤقتة: عدّلها قبل قبول أي دفع.
- **مفتاح OpenCode Go:** شروطه تقول إن خطة Go «لمساحة عمل بعضو واحد». أنت أكّدت سابقاً أن إعادة البيع مسموحة؛ تأكد من ذلك كتابياً قبل الإطلاق التجاري.
