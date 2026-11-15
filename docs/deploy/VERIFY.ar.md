# كيف تتأكد أن كل شيء يعمل

## ما يُفحص آلياً في كل مرة (GitHub Actions)

| المستودع | الفحص | ماذا يثبت |
|---|---|---|
| deepcode-studio | `ci` → build · typecheck · lint · tests | البوابة والموقع وقاعدة البيانات (Postgres وRedis حقيقيان): المفاتيح، الحصص، الفوترة، UPI، حذف الحساب، تحديد المعدّل |
| deepcode-studio | `ci` → web e2e | الموقع في متصفحَي Chrome وSafari (WebKit)، عربي/إنجليزي، حاسوب/هاتف: الحماية، التسجيل، الدفع التجريبي، صفحة التحميل، إمكانية الوصول |
| deepcode-studio | `ci` → deploy image | صورة Render تُبنى |
| deepcode-studio | `ci` → secrets | لا أسرار في الكود |
| deepcode-desktop | Checks | typecheck · lint · المعمارية · تسرّب العلامة · اختبارات DeepCode · أمان مزامنة ZCodium |
| deepcode-desktop | Build × 5 (Linux x64/arm64، Windows x64، macOS arm64/x64) | يُبنى المثبّت، ثم **يُشغَّل التطبيق المغلّف فعلاً**: تفتح نافذته، تجهز قاعدة بياناته، اسمه DeepCode Studio، جسر الحساب يعمل وزر الدخول ظاهر، ولا يحاول الاتصال بأي خادم Z.ai. لقطات شاشة وتقرير JSON في Artifacts باسم `smoke-<نظام>-<معمارية>` |

لتشغيل بناء تجريبي كامل: Actions → DeepCode Desktop → Run workflow (اترك checks only فارغاً).

## ما يجب أن تجرّبه بنفسك (مرة بعد النشر، ثم بعد كل إصدار)

لا يمكن أتمتته لأنه يحتاج حساباتك الحقيقية وهاتفك ومالاً حقيقياً.

### الخادم
- [ ] `https://<عنوانك>/healthz` يعيد `{"ok":true}` و`/readyz` يعيد 200.
- [ ] التسجيل ببريد حقيقي ← يصل بريد التأكيد (Brevo) ← الدخول.
- [ ] `/admin` يطلب التحقق بخطوتين ثم يفتح.
- [ ] `/admin/pool`: أضف مفتاح OpenCode Go — لا يظهر مرة أخرى.
- [ ] من `/dashboard/keys` أنشئ مفتاحاً، ثم من جهازك:

```bash
curl -N https://<عنوانك>/v1/chat/completions -H "Authorization: Bearer sk-dc-..." -H "content-type: application/json" -d '{"model":"glm-5.3-flash","stream":true,"messages":[{"role":"user","content":"قل مرحباً"}]}'
```

  يجب أن يصل الرد متدفقاً، وأن ينقص الرصيد في `/dashboard/usage`.

### الدفع (بمبلغ صغير)
- [ ] اجعل سعر باقة مؤقتاً ₹1 من `/admin/plans`.
- [ ] اخترها ← يظهر QR ← ادفع من PhonePe ← أدخل UTR.
- [ ] يصل إشعار للهاتف ← تبويب DeepCode ← المبلغ وUTR صحيحان ← موافقة.
- [ ] تظهر الباقة نشطة في `/dashboard/billing`.
- [ ] أدخل نفس UTR مرة أخرى في إيداع smm ← يجب أن يُرفض.
- [ ] أعد السعر الحقيقي.

### تطبيق سطح المكتب — على كل نظام (Windows، macOS، Linux)
- [ ] التثبيت من GitHub Release (Windows: «Run anyway»؛ macOS: «Open Anyway»).
- [ ] الواجهة عربية من اليمين لليسار، والمحرر والطرفية من اليسار لليمين.
- [ ] «تسجيل الدخول إلى DeepCode» ← يفتح المتصفح ← موافقة ← يعود التطبيق مسجّلاً، ويظهر الرصيد في الشريط الجانبي.
- [ ] رسالة في المحادثة ← يصل الرد ← ينقص الرصيد خلال دقيقة.
- [ ] أغلق التطبيق وافتحه ← ما زلت مسجّلاً.
- [ ] من `/dashboard/devices` ألغِ الجهاز ← التطبيق يخرج عند الطلب التالي.
- [ ] اجعل الرصيد صفراً من `/admin/users` ← تظهر نافذة «نفد الرصيد».
- [ ] التحديث: انشر `v0.1.1` وسجّله في `/admin/releases` ← تطبيق `v0.1.0` على Windows/Linux يعرض التحديث (macOS: يدوي بدون شهادة).
