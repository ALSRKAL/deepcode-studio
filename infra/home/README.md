# خادم DeepCode على جهازك، بلا بطاقة ولا دومين مدفوع

<div dir="rtl">

هذا هو الإعداد الفعلي للخدمة: جهازك هو الخادم الوحيد، ويظهر للإنترنت عبر
**Tailscale Funnel** بعنوان ثابت:

**https://alsrkal.tail31ef3c.ts.net**

قاعدة البيانات **Postgres 18** و**Redis 7** تعملان داخل Docker على نفس الجهاز.
لا Neon، لا Redis Cloud، لا Render. لذلك لا توجد حدود ساعات حوسبة ولا حد 30MB
ولا حد باندويث شهري معروف.

## كيف يعمل

</div>

```
المستخدم (ويب / ديسكتوب / هاتف)
        │  HTTPS + WebSocket + SSE
        ▼
Tailscale Funnel  (شهادة TLS، بدون فتح منفذ في الراوتر)
        │
        ▼
Caddy :10000
   ├─ /v1/*        → gateway :8790   (بث SSE)
   ├─ /remote/*    → relay :8443     (WS + صفحة الهاتف)
   └─ /*           → web :3000
        │
        ├─ Postgres 18  (حجم pgdata)
        └─ Redis 7      (AOF، كاش وحدود ومؤقتات)
```

<div dir="rtl">

- لا يفتح جهازك أي منفذ في الراوتر، وعنوان IP الخاص بك لا يظهر للمستخدمين.
- كل رد يحمل `X-DeepCode-Server: home`.
- الأسرار في `../render/render.env` و`home.env` و`.env`: لا تشاركها ولا ترفعها.

## التشغيل اليومي

| الأمر | ماذا يفعل |
| --- | --- |
| `./setup.sh` | يبني ويشغّل كل شيء (Postgres + Redis + التطبيق) |
| `./setup.sh update` | يعيد البناء بآخر كود ثم يعيد التشغيل |
| `./setup.sh stop` | يوقف كل شيء؛ الموقع يتوقف |
| `./backup.sh` | نسخة احتياطية فورية من قاعدة البيانات |
| `docker compose logs -f deepcode` | متابعة السجلات |
| `docker compose ps` | حالة الخدمات |

بعد إعادة تشغيل الجهاز تعود الحاويات تلقائياً (`restart: unless-stopped`)،
وTailscale وFunnel يعملان كخدمة نظام.

## النسخ الاحتياطي

- نسخة يومية الساعة 03:17 إلى `~/deepcode-backups/`، مع الاحتفاظ بآخر 14 نسخة.
- السطر مثبّت في `crontab` الخاص بالمستخدم:
  `17 3 * * * cd ".../infra/home" && ./backup.sh >> "$HOME/deepcode-backups/backup.log" 2>&1`
- للاستعادة:
  `docker compose exec -T postgres pg_restore -U deepcode -d deepcode --clean --if-exists < backup.dump`

## تطبيق الديسكتوب

عنوان البوابة يُحقن وقت البناء، لكن الجلسة تحمل عنوان البوابة القادم من
`/api/desktop/exchange`. لذلك:

- **نسخة مثبتة مسبقاً:** من إعدادات التطبيق غيّر الـ endpoint إلى
  `https://alsrkal.tail31ef3c.ts.net`، ثم سجّل الخروج والدخول.
- **بناء جديد:** متغيرات مستودع `ALSRKAL/deepcode-desktop` صارت:
  `DEEPCODE_GATEWAY_URL` و`DEEPCODE_WEB_ORIGIN` و`DEEPCODE_PUBLIC_URL`
  = `https://alsrkal.tail31ef3c.ts.net`.
- **Google OAuth:** أضف عنوان إعادة التوجيه
  `https://alsrkal.tail31ef3c.ts.net/api/auth/callback/google`
  في Google Cloud Console، وإلا يعمل الدخول بالبريد فقط.

## الطاقة والحدود

| البند | القيمة المقاسة / المتوقعة |
| --- | --- |
| سرعة Funnel | 38MB/s تنزيل و56MB/s رفع (اختبار 5MB) |
| استهلاكك الحالي | ~54GB شهرياً (كان 7.26GB في 3 أيام على Render) |
| ذاكرة الحزمة | ~400MB للتطبيق + 40MB لـPostgres + 5MB لـRedis |
| المعالج | 8 أنوية، والاستخدام أقل من 1% في الخمول |
| تزامن المزوّد | **8 طلبات** لكل مفتاح upstream (القيد الحقيقي) |

**القيد الحقيقي ليس الاستضافة:** مفتاح upstream واحد بحد `max_concurrency = 8`.
لزيادة المستخدمين المتزامنين أضف مفاتيح upstream (كل مفتاح يضيف 8)، أو ارفع
`max_concurrency` إذا سمح المزوّد. خطط المستخدمين نفسها تحدّ التزامن:
free = 1، starter = 2، pro = 4، team = 8 لكل مستخدم.

## ملاحظات

- Funnel في مرحلة beta وعليه «حدود باندويث غير قابلة للتعديل» حسب توثيق Tailscale،
  لكن القياس الفعلي أعطى سرعات عالية. راقب الاستهلاك شهرياً.
- الجهاز نقطة فشل واحدة: إذا انطفأ أو انقطع الإنترنت يتوقف الموقع. النسخ
  الاحتياطية اليومية تحمي البيانات، ويمكن تشغيل نفس الصورة على أي خادم لاحقاً.
- ملفات المهارات المرفوعة تُحفظ في `infra/home/storage` وتبقى بعد إعادة التشغيل.
- Render لم يعد جزءاً من الخدمة. `render.yaml` وبقية ملفاته باقية كمرجع فقط.
</div>
