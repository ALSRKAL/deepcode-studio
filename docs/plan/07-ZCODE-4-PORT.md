# خطة نقل DeepCode Studio إلى ZCode 4.0.0 (A ثم C)

> قرار المالك 2026-11-23: البرنامج العام يعمل على OpenCode Go فقط، وSynthetic لحساب
> المالك وحده. هذه الخطة تخص **سطح المكتب** ولا تغيّر بوابة النماذج أو خططها.

## 1. الهدف والنطاق

**الهدف:** إصدار سطح مكتب مبني على ZCode 4.0.0، بهوية DeepCode الكاملة، بعد اختبار
ترقية فعلي من 3.16.2، دون كسر حسابات أو بيانات المستخدمين.

**داخل النطاق:**
- شجرة ZCode 4.0.0 كمصدر أعلى.
- الهوية: الاسم، الشعار، العربية/RTL، حساب DeepCode، بوابة النماذج، الهاتف.
- ترحيل الإعدادات والاعتمادات وقاعدة المهام وفهرس المشاريع.
- حذف خدمات z.ai/BigModel والبوتات من مسار المستخدم.
- قنوات الإصدار: preview ثم stable.

**خارج النطاق:**
- تغيير خطط/أسعار البوابة (تم في السيرفر).
- إعادة كتابة ميزات ZCode الأصلية.
- شحن أي مفاتيح أو أسرار داخل الحزمة.

## 2. لماذا لا يُدمج 4.0.0 كـ merge

| القياس | القيمة |
|---|---|
| ملفات متغيّرة بين قاعدتنا و4.0.0 | ~15,172 |
| تعارضات حقيقية عند الدمج المباشر | **1,182** |
| تعارضات 3.18.2 (آخر ZCodium) | 27 (بعد الحل الآلي) |
| ملفات DeepCode المعدّلة عن ZCodium 3.16.2 | 848 |

4.0.0 لقطة مصدر كاملة، وأغلب تعارضاتها تُعيد OAuth وخدمات z.ai/BigModel والبوتات.
لذلك المسار الآمن هو **إعادة تأسيس (re-base)** لطبقة الهوية فوق v4، لا merge.

## 3. الفروع والبوابات

| الفرع | الغرض | قواعد |
|---|---|---|
| `vendor/zcode-4.0.0` | نسخة المصدر الأصلية عند tag `v4.0.0` | لا تعديل، لا دفع لـ main |
| `deepcode/v4` | طبقة DeepCode فوق v4 | لا يُدمج في main إلا بعد كل البوابات |
| `upstream-sync/6cdfd0b` | مسار C: نقل 3.18.2 الاحتياطي | يبقى كخط رجوع |
| `deepcode/rebrand` | الإصدار الحالي 3.16.2 + Go-only | لا يُلمس أثناء A |

**قاعدة ذهبية:** لا merge commit من `vendor` إلى `deepcode`؛ التطبيق عبر
patch/codemods قابلة لإعادة التشغيل.

## 4. حزم العمل

### W1 — خط الأساس والبناء (A0)
1. worktree نظيف من `v4.0.0`.
2. بناء أصلي ناجح: `pnpm install --frozen-lockfile`، `pnpm typecheck`، `pnpm build:bootstrap`.
3. تسجيل الفروق في `docs/plan/07-baseline.md` (عدد الملفات، الحزم الجديدة).
4. قبول: بناء v4 الأصلي ينجح قبل أي تعديل DeepCode.

### W2 — الهوية والترجمة (A1)
- `scripts/codemod/logical-classes.mjs` ثم `brand-strings.mjs` على شجرة v4.
- توليد `config/provider/deepcode-builtin.json` من `zcode-builtin.json`.
- دمج مفاتيح `en-US.ts` الجديدة في `ar.ts`، وترجمة `TODO(ar)`.
- فحص `brand-leak-check.mjs` (يجب ألا يظهر ZCode/Z.ai في مسار المستخدم).
- قبول: العربية RTL افتراضية، لا نصوص علامة قديمة في الحزمة.

### W3 — الحساب والنماذج (A2)
- إعادة ربط:
  - `deepcodeAccount.ts` (main)
  - `account-provider-resolution.ts`
  - `deepcodeAccountConnections.ts`
  - `DEEPCODE_MODELS` و`modelSelectionGroups`
- البوابة ترسل نماذج الخطة فقط؛ سطح المكتب لا يُظهر Synthetic لغير المالك.
- قبول: الدخول/الخروج، تجديد النماذج كل 5 دقائق، وخطة owner ترى Synthetic.

### W4 — الخدمات والوكيل (A3)
- دمج `accessor.ts` و`node.ts` و`index.ts` مع خدمات v4 الجديدة (memory، app-control،
  source-server، extensions، data-sync).
- إزالة `bots/*` و`AstrBot` وFeishu/WeChat من كل واجهات الخدمة.
- اختبارات الخدمات + typecheck.
- قبول: لا أخطاء typecheck في `packages/services` و`packages/desktop/tsconfig.host`.

### W5 — Electron main/preload/renderer (A4) — أكبر خطر
- `packages/client/src/globals.d.ts`: واجهات preload الجديدة.
- `packages/desktop/src/main/index.ts`: تسجيل IPC الجديد.
- `renderer/src/desktopPlatform.ts` و`desktopBrowserPlatformBridge.ts`.
- `cuaPermissionPanelMessages` و`desktopWindowsOpenFolderContextMenu` (locale ar).
- قبول: `tsc -b` لكل tsconfigs v4 (main/preload/renderer/scheduler/app-navigation)
  ينجح، ثم حزمة smoke على Linux/Windows/macOS.

### W6 — الهاتف والاتصال (A5)
- نقل remote control إلى واجهات v4 أو إبقاء relay الحالي؛ لا تنفيذان متوازيان.
- اختبار QR، إعادة الاتصال، قطع الشبكة، وصلاحيات المنسوخ.
- قبول: `test:web-remote-control-mobile` و`remote-web` أخضران.

### W7 — ترحيل البيانات (A6)
- إعدادات `settings.json`، `credentials.json`، قاعدة المهام، فهرس المشاريع.
- سيناريوهات: ترقية 3.16.2 → 4.0، رجوع 4.0 → 3.16.2، مستخدم بلا بيانات.
- قبول: لا فقدان مشاريع/محادثات، والرجوع يعمل.

### W8 — الإصدار وDevOps (A7)
1. CI: `pnpm typecheck && pnpm lint && pnpm architecture:check && brand-leak &&
   upstream-sync safety && DeepCode tests`.
2. packaged smoke Linux/Windows/macOS.
3. update smoke: تثبيت 3.16.2 → تحديث إلى 4.0 → التحقق من الإصدار.
4. نشر preview (tag `v1.0.0-preview.1`) ثم stable.
5. استيراد الإصدار في `/admin/releases` (أو سكربت import) والتحقق من manifest.
6. خطة رجوع: الإبقاء على إصدار 3.16.2 في feed، وإمكانية سحب الإصدار الجديد.

## 5. بوابات الجودة (Definition of Done)

- [ ] بناء v4 الأصلي ناجح.
- [ ] `pnpm typecheck` و`lint` و`architecture:check` خضراء.
- [ ] brand-leak: لا ZCode/Z.ai/BigModel في مسار المستخدم.
- [ ] لا خدمات bots/z.ai مفعّلة أو قابلة للاتصال.
- [ ] الحساب/النماذج: public Go-only، owner Synthetic فقط.
- [ ] الترقية من 3.16.2 تحفظ الإعدادات والمشاريع والمحادثات.
- [ ] تحديث تلقائي ناجح + الرجوع ناجح.
- [ ] smoke على الأنظمة الثلاثة.
- [ ] مراجعة أمنية: لا أسرار في الحزمة، لا مضيفات غير خادمنا.
- [ ] توثيق CHANGELOG وREADME.ar.

## 6. المخاطر والتراجع

| الخطر | الاحتمال | التخفيف | التراجع |
|---|---|---|---|
| تعارضات v4 الهيكلية | مرتفع | worktree + patch queue | العودة إلى 3.16.2/3.18 |
| كسر Electron IPC | مرتفع | typecheck لكل tsconfig + smoke | إصدار سابق |
| عودة z.ai/BigModel | مرتفع | brand-leak + مراجعة service refs | إزالة الملفات/المسارات |
| فقدان بيانات الترقية | متوسط | نسخة احتياطية + سيناريو رجوع | استعادة النسخة |
| استهلاك Go أكثر من السعة | متوسط | 10 مستخدمين × Team 5M = 50M ≤ 60M | خفض الحدود/إضافة مفتاح |
| كسر التحديث التلقائي | متوسط | update smoke + preview | سحب الإصدار |

## 7. التقدير

| المسار | التقدير |
|---|---|
| A0–A2 (أساس + هوية + حساب) | 3–5 أيام عمل |
| A3–A5 (خدمات + Electron + هاتف) | 5–8 أيام |
| A6–A7 (ترحيل + اختبار + إصدار) | 3–4 أيام |
| **الإجمالي** | **~2 أسابيع عمل مركّز** |
| C (إكمال 3.18) | 2–4 أيام (الفرع جاهز جزئياً) |

الوقت تقديري، وليس وعداً؛ كل مرحلة تُغلق ببوابة اختبار.

## 8. قرار التنفيذ

- **A** هو المسار الأساسي: إعادة تأسيس v4 على `deepcode/v4`.
- **C** يبقى خطة رجوع/إصدار وسيط: إكمال 3.18.2 من `upstream-sync/6cdfd0b` إذا
  احتجنا تحديثاً أسرع قبل جهوزية v4.
- لا يُنشر أي شيء للمستخدمين قبل نجاح W8 كاملاً.
