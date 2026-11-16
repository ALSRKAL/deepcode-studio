<div align="center" dir="rtl">
  <h1>DeepCode Studio — الخادم</h1>
  <p><strong>البوابة والموقع والفوترة ولوحة الإدارة لبيئة البرمجة DeepCode Studio.</strong></p>
  <p><a href="README.md">English</a> · العربية</p>
  <p>
    <a href="https://deepcode-2sfl.onrender.com/ar">الموقع</a> ·
    <a href="https://github.com/ALSRKAL/deepcode-desktop">تطبيق سطح المكتب</a> ·
    <a href="docs/deploy/README.ar.md">دليل النشر</a>
  </p>
</div>

<div dir="rtl">

هذا المستودع يشغّل كل ما خلف [تطبيق DeepCode Studio](https://github.com/ALSRKAL/deepcode-desktop):

- **البوابة** (`apps/gateway`): واجهة API واحدة متوافقة مع OpenAI وAnthropic (`/v1`) أمام مزوّد
  النماذج (Synthetic.new)، مع نماذج لكل خطة، وحساب دقيق للاستهلاك بالرصيد لكل توكن، وحدود
  الطلبات والتزامن، والبث، والبحث في الويب، ومجموعة مفاتيح المزوّد.
- **الموقع ولوحة المستخدم** (`apps/web`، Next.js، عربي وإنجليزي): الأسعار، التسجيل مع تجربة
  مجانية 24 ساعة، لوحة الحساب (الاستهلاك، مفاتيح API، الأجهزة، الفوترة، الإعدادات)، تسجيل
  الدخول من التطبيق، التنزيلات وقناة التحديثات.
- **لوحة الإدارة**: المستخدمون (الرصيد، الخطط، إلغاء المفاتيح، حذف الحساب)، المدفوعات، كتالوج
  النماذج، مفاتيح المزوّد، الإصدارات، المتجر وسجل التدقيق.
- **الدفع**: رمز UPI QR تتم الموافقة عليه من تطبيق المالك على الهاتف.
- **وسيط التحكم من الجوال** (`infra/render/remote`): يتيح التحكم بالتطبيق من الهاتف من أي شبكة.

## البنية

</div>

```
desktop app ──► /v1/*        gateway (Node)  ──► model provider
browser     ──► /*           website (Next.js) ──► Postgres, Redis
phone       ──► /remote/*    relay (WebSocket) ◄── desktop app
```

<div dir="rtl">

الأجزاء الثلاثة تعمل في حاوية واحدة خلف Caddy (`infra/render/Dockerfile`)، مع Postgres وRedis
كخدمات مُدارة.

## التطوير

المتطلبات: Node 24 وpnpm 10 وDocker.

</div>

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:migrate && pnpm db:seed
pnpm dev:gateway
pnpm --filter @deepcode/web dev
```

<div dir="rtl">

## النشر

صورة Docker واحدة (`infra/render/Dockerfile`) على Render؛ راجع [دليل النشر خطوة بخطوة](docs/deploy/README.ar.md).
الأسرار موجودة فقط في بيئة الاستضافة، وليست في هذا المستودع.

## الترخيص

حقوق النشر © 2026 DeepCode Studio. جميع الحقوق محفوظة. كود الخادم منشور للشفافية فقط، ولا يُمنح
أي ترخيص لاستخدامه أو نسخه أو إعادة توزيعه. تطبيق سطح المكتب مفتوح المصدر بترخيص Apache-2.0 في
[deepcode-desktop](https://github.com/ALSRKAL/deepcode-desktop).

</div>
