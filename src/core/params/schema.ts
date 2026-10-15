/**
 * VaseForge — parameter schema (single source of truth).
 *
 * - Every leaf carries UI metadata (fa/en label + tooltip, unit, slider step,
 *   Basic/Advanced level, delivery phase) in the `paramMeta` registry.
 * - The English tooltip is also attached via `.describe()` so
 *   `z.toJSONSchema(VaseParamsSchema)` yields a self-documented JSON Schema
 *   for the AI module.
 * - Conventions: Z up, origin at the centre of the base, lengths in mm,
 *   heights given as % of total height (0–100), angles in degrees.
 * - Diameters are circumscribed (max-extent) diameters of the base shape
 *   (before surface effects).
 * - The schema only enforces ranges and structural consistency. Physical
 *   printability (overhangs, mode compatibility, bed size, …) is reported by
 *   /core/printability, never rejected here.
 *
 * Requires zod >= 4 (registries, .prefault, z.toJSONSchema).
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export type Unit = 'mm' | '%' | 'deg' | 'turns' | 'x' | '';
export interface I18nText {
  fa: string;
  en: string;
}
export interface ParamMeta {
  label: I18nText;
  help: I18nText;
  level: 'basic' | 'advanced';
  /** Delivery phase in which the parameter becomes active in the UI/engine. */
  phase: 1 | 2 | 3;
  unit?: Unit;
  min?: number;
  max?: number;
  step?: number;
  /** Labels for enum options. */
  options?: Record<string, I18nText>;
}

export const paramMeta = z.registry<ParamMeta>();

interface M {
  fa: string;
  en: string;
  /** Tooltip [fa, en]. */
  tip: [string, string];
  basic?: boolean;
  phase?: 1 | 2 | 3;
  unit?: Unit;
  step?: number;
  options?: Record<string, I18nText>;
}

function meta<T extends z.ZodType>(schema: T, m: M, range?: { min: number; max: number }): T {
  const described = schema.describe(m.tip[1]) as T;
  (described as z.ZodType).register(paramMeta, {
    label: { fa: m.fa, en: m.en },
    help: { fa: m.tip[0], en: m.tip[1] },
    level: m.basic ? 'basic' : 'advanced',
    phase: m.phase ?? 1,
    unit: m.unit,
    step: m.step,
    options: m.options,
    ...range,
  });
  return described;
}

const num = (min: number, max: number, def: number, m: M) =>
  meta(z.number().min(min).max(max).default(def), m, { min, max });

const int = (min: number, max: number, def: number, m: M) =>
  meta(z.number().int().min(min).max(max).default(def), m, { min, max });

const pct = (def: number, m: Omit<M, 'unit'>) => num(0, 100, def, { step: 1, ...m, unit: '%' });

const bool = (def: boolean, m: M) => meta(z.boolean().default(def), m);

function enm<const T extends readonly [string, ...string[]]>(
  values: T,
  def: T[number],
  m: M & { options: Record<T[number], I18nText> },
) {
  return meta(z.enum(values).default(def as never), m);
}

const seed = (m?: Partial<M>) =>
  int(0, 0xffffffff, 1, {
    fa: 'بذر تصادفی',
    en: 'Seed',
    tip: ['عدد ثابت = نتیجهٔ ثابت. برای طرح جدید تغییرش بدهید.', 'Same seed ⇒ identical result.'],
    step: 1,
    ...m,
  });

const t = (fa: string, en: string): I18nText => ({ fa, en });

// ---------------------------------------------------------------------------
// A) Dimensions
// ---------------------------------------------------------------------------

export const DimensionsSchema = z
  .object({
    height: num(40, 300, 180, {
      fa: 'ارتفاع', en: 'Height', unit: 'mm', step: 1, basic: true,
      tip: ['ارتفاع کل گلدان؛ باید از ارتفاع چاپ پرینتر کمتر باشد.', 'Overall height; must fit the printer Z.'],
    }),
    baseDiameter: num(30, 200, 80, {
      fa: 'قطر کف', en: 'Base diameter', unit: 'mm', step: 0.5, basic: true,
      tip: ['قطر کف گلدان. کف پهن‌تر = پایداری بیشتر.', 'Diameter at the base. Wider = more stable.'],
    }),
    topDiameter: num(10, 200, 70, {
      fa: 'قطر دهانه', en: 'Top diameter', unit: 'mm', step: 0.5, basic: true,
      tip: ['قطر لبهٔ بالایی (پیش از بازشدگی لبه).', 'Diameter at the rim (before rim flare).'],
    }),
    maxDiameter: num(30, 250, 110, {
      fa: 'بیشترین قطر (شکم)', en: 'Belly diameter', unit: 'mm', step: 0.5, basic: true,
      tip: ['قطر پهن‌ترین بخش بدنه در فرم‌های شکم‌دار.', 'Widest diameter of the body for bellied profiles.'],
    }),
    neckDiameter: num(10, 200, 50, {
      fa: 'قطر گردن', en: 'Neck diameter', unit: 'mm', step: 0.5,
      tip: ['قطر باریک‌ترین بخش در فرم‌های گردن‌دار/کمردار.', 'Narrowest diameter for necked/waisted profiles.'],
    }),
    bellyPosition: pct(40, {
      fa: 'ارتفاع شکم', en: 'Belly position', basic: true,
      tip: ['محل پهن‌ترین بخش، درصدی از ارتفاع.', 'Height of the widest point, % of height.'],
    }),
    neckPosition: pct(80, {
      fa: 'ارتفاع گردن', en: 'Neck position',
      tip: ['محل باریک‌ترین بخش بالایی، درصدی از ارتفاع.', 'Height of the neck, % of height.'],
    }),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// B) Profile
// ---------------------------------------------------------------------------

export const PROFILE_PRESETS = [
  'straight', 'taper', 'convex', 'concave', 'teardrop', 'sphere', 'jar', 'tulip', 'hourglass',
  'sCurve', 'amphora', 'urn', 'bottle', 'doubleBulge', 'flaredTrumpet', 'goblet', 'onionDome',
  'custom',
] as const;
export type ProfilePreset = (typeof PROFILE_PRESETS)[number];

export const ProfilePointSchema = z.object({
  t: num(0, 100, 0, {
    fa: 'ارتفاع نقطه', en: 'Point height', unit: '%', step: 0.5,
    tip: ['ارتفاع نقطهٔ کنترل، درصدی از ارتفاع.', 'Control point height, % of height.'],
  }),
  r: num(0.05, 1, 0.7, {
    fa: 'شعاع نسبی', en: 'Radius factor', unit: 'x', step: 0.01,
    tip: ['شعاع نسبت به نصف بیشترین قطر.', 'Radius as a fraction of maxDiameter / 2.'],
  }),
  sharp: bool(false, {
    fa: 'گوشهٔ تیز', en: 'Sharp corner',
    tip: ['منحنی در این نقطه شکسته می‌شود.', 'Curve has a crease at this point.'],
  }),
});

const DEFAULT_PROFILE_POINTS = [
  { t: 0, r: 0.72, sharp: false },
  { t: 40, r: 1, sharp: false },
  { t: 80, r: 0.55, sharp: false },
  { t: 100, r: 0.64, sharp: false },
];

export const ProfileSchema = z
  .object({
    preset: enm(PROFILE_PRESETS, 'convex', {
      fa: 'فرم نیم‌رخ', en: 'Profile', basic: true,
      tip: ['منحنی کلی بدنه از پایین تا بالا.', 'Overall silhouette from base to rim.'],
      options: {
        straight: t('استوانه‌ای', 'Straight'), taper: t('مخروطی', 'Taper'),
        convex: t('محدب', 'Convex'), concave: t('مقعر', 'Concave'),
        teardrop: t('قطره‌ای', 'Teardrop'), sphere: t('کروی', 'Sphere'),
        jar: t('کوزه‌ای', 'Jar'), tulip: t('لاله‌ای', 'Tulip'),
        hourglass: t('ساعت شنی', 'Hourglass'), sCurve: t('منحنی S', 'S-curve'),
        amphora: t('آمفورا', 'Amphora'), urn: t('کوزهٔ پایه‌دار', 'Urn'),
        bottle: t('بطری', 'Bottle'), doubleBulge: t('دوشکمه', 'Double bulge'),
        flaredTrumpet: t('شیپوری', 'Flared trumpet'), goblet: t('جامی', 'Goblet'),
        onionDome: t('گنبد پیازی', 'Onion dome'), custom: t('سفارشی', 'Custom'),
      },
    }),
    strength: pct(60, {
      fa: 'پُری منحنی', en: 'Fullness', basic: true,
      tip: ['۰ = خطوط زاویه‌دار، ۱۰۰ = منحنی کاملاً پُر و گرد.', '0 = angular, 100 = fully rounded curves.'],
    }),
    controlPoints: meta(
      z.array(ProfilePointSchema).min(3).max(12).default(DEFAULT_PROFILE_POINTS),
      {
        fa: 'نقاط کنترل نیم‌رخ', en: 'Profile control points',
        tip: ['فقط برای نیم‌رخ سفارشی. اولین نقطه در ۰٪ و آخرین در ۱۰۰٪.', 'Custom profile only. First at 0 %, last at 100 %.'],
      },
    ),
    waveCycles: num(0, 8, 0, {
      fa: 'تعداد موج نیم‌رخ', en: 'Profile wave cycles', step: 0.25,
      tip: ['موج‌های افقی بزرگ روی نیم‌رخ.', 'Large horizontal undulations along the profile.'],
    }),
    waveAmplitude: num(0, 15, 0, {
      fa: 'دامنهٔ موج نیم‌رخ', en: 'Profile wave amplitude', unit: 'mm', step: 0.1,
      tip: ['عمق موج‌های نیم‌رخ.', 'Radial amplitude of the profile waves.'],
    }),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// C) Cross-section
// ---------------------------------------------------------------------------

export const SECTION_SHAPES = [
  'circle', 'polygon', 'star', 'flower', 'superellipse', 'supershape', 'custom', 'svg',
] as const;
export type SectionShape = (typeof SECTION_SHAPES)[number];

export const PolarPointSchema = z.object({
  a: num(0, 1, 0, {
    fa: 'زاویهٔ نسبی', en: 'Angle', unit: 'x', step: 0.01,
    tip: ['موقعیت در یک بخش تقارن (۰ تا ۱).', 'Position within one symmetry sector (0–1).'],
  }),
  r: num(0.2, 1, 1, {
    fa: 'شعاع نسبی', en: 'Radius', unit: 'x', step: 0.01,
    tip: ['شعاع نسبی نقطه.', 'Relative radius of the point.'],
  }),
});

export const SectionSchema = z
  .object({
    shape: enm(SECTION_SHAPES, 'circle', {
      fa: 'شکل مقطع', en: 'Section shape', basic: true,
      tip: ['شکل برش افقی گلدان.', 'Shape of the horizontal cross-section.'],
      options: {
        circle: t('دایره', 'Circle'), polygon: t('چندضلعی', 'Polygon'), star: t('ستاره', 'Star'),
        flower: t('گل', 'Flower'), superellipse: t('سوپربیضی', 'Superellipse'),
        supershape: t('سوپرشیپ', 'Supershape'), custom: t('طراحی دستی', 'Custom'), svg: t('فایل SVG', 'SVG'),
      },
    }),
    sides: int(3, 24, 6, {
      fa: 'تعداد اضلاع', en: 'Sides', step: 1, basic: true,
      tip: ['تعداد اضلاع چندضلعی.', 'Number of polygon sides.'],
    }),
    cornerRadius: num(0, 10, 2, {
      fa: 'شعاع گوشه', en: 'Corner radius', unit: 'mm', step: 0.1,
      tip: ['گرد کردن گوشه‌های چندضلعی.', 'Rounds the polygon corners.'],
    }),
    starPoints: int(3, 24, 8, {
      fa: 'تعداد پرهٔ ستاره', en: 'Star points', step: 1,
      tip: ['تعداد نوک‌های ستاره.', 'Number of star tips.'],
    }),
    starInnerRatio: num(0.3, 0.95, 0.8, {
      fa: 'نسبت داخلی ستاره', en: 'Star inner ratio', unit: 'x', step: 0.01,
      tip: ['کمتر = پره‌های تیزتر و عمیق‌تر.', 'Lower = deeper, sharper points.'],
    }),
    petals: int(3, 16, 6, {
      fa: 'تعداد گلبرگ', en: 'Petals', step: 1,
      tip: ['تعداد گلبرگ‌های مقطع گل.', 'Number of flower petals.'],
    }),
    petalDepth: num(0, 40, 20, {
      fa: 'عمق گلبرگ', en: 'Petal depth', unit: '%', step: 1,
      tip: ['فرورفتگی بین گلبرگ‌ها (حداکثر ۴۰٪).', 'Indent between petals (max 40 %).'],
    }),
    superellipseExponent: num(2, 10, 4, {
      fa: 'توان سوپربیضی', en: 'Superellipse exponent', step: 0.1,
      tip: ['۲ = بیضی، بیشتر = مربع‌گون.', '2 = ellipse, higher = squarer.'],
    }),
    aspectXY: num(0.5, 2, 1, {
      fa: 'نسبت طول به عرض', en: 'Aspect X/Y', unit: 'x', step: 0.01,
      tip: ['کشیدگی مقطع در راستای X.', 'Stretches the section along X.'],
    }),
    supershape: z
      .object({
        m: int(0, 20, 5, { fa: 'تقارن m', en: 'Symmetry m', step: 1, phase: 2, tip: ['تعداد تکرار سوپرشیپ.', 'Supershape rotational symmetry.'] }),
        n1: num(0.1, 100, 2, { fa: 'توان n1', en: 'n1', step: 0.1, phase: 2, tip: ['توان کلی؛ کمتر = تیزتر.', 'Overall exponent; lower = pinched.'] }),
        n2: num(0.1, 100, 7, { fa: 'توان n2', en: 'n2', step: 0.1, phase: 2, tip: ['توان جملهٔ کسینوس.', 'Cosine-term exponent.'] }),
        n3: num(0.1, 100, 7, { fa: 'توان n3', en: 'n3', step: 0.1, phase: 2, tip: ['توان جملهٔ سینوس.', 'Sine-term exponent.'] }),
        a: num(0.5, 2, 1, { fa: 'ضریب a', en: 'a', step: 0.01, phase: 2, tip: ['مقیاس جملهٔ کسینوس.', 'Cosine-term scale.'] }),
        b: num(0.5, 2, 1, { fa: 'ضریب b', en: 'b', step: 0.01, phase: 2, tip: ['مقیاس جملهٔ سینوس.', 'Sine-term scale.'] }),
      })
      .prefault({}),
    custom: z
      .object({
        symmetry: int(1, 12, 6, {
          fa: 'تقارن چرخشی (فرفره)', en: 'Rotational symmetry', step: 1, phase: 2,
          tip: ['منحنی کشیده‌شده k بار دور محور تکرار می‌شود.', 'The drawn sector repeats k times ("windmill").'],
        }),
        mirror: bool(false, {
          fa: 'قرینهٔ آینه‌ای', en: 'Mirror sector', phase: 2,
          tip: ['هر بخش قرینه هم می‌شود (کالیدوسکوپ).', 'Mirror each sector (kaleidoscope) instead of windmill.'],
        }),
        points: meta(
          z.array(PolarPointSchema).min(3).max(24).default([
            { a: 0, r: 1 }, { a: 0.5, r: 0.8 }, { a: 0.8, r: 0.9 },
          ]),
          { fa: 'نقاط طراحی', en: 'Drawn points', phase: 2, tip: ['نقاط قطبی یک بخش تقارن.', 'Polar points of one symmetry sector.'] },
        ),
      })
      .prefault({}),
    svg: z
      .object({
        name: meta(z.string().max(120).default(''), {
          fa: 'نام فایل', en: 'File name', phase: 2, tip: ['فایل SVG واردشده.', 'Imported SVG file.'],
        }),
        /** Normalised polar radii, uniformly spaced over 360°. Empty ⇒ circle. */
        samples: meta(z.array(z.number().min(0.05).max(1)).max(720).default([]), {
          fa: 'نمونه‌های قطبی', en: 'Polar samples', phase: 2,
          tip: ['شعاع‌های نرمال‌شدهٔ حاصل از پرتو از مرکز.', 'Normalised radii from centroid ray casting.'],
        }),
      })
      .prefault({}),
  })
  .prefault({});
export type Section = z.infer<typeof SectionSchema>;

export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'sine'] as const;
const EASING_LABELS = {
  linear: t('خطی', 'Linear'), easeIn: t('آهسته در شروع', 'Ease in'), easeOut: t('آهسته در پایان', 'Ease out'),
  easeInOut: t('نرم دوطرفه', 'Ease in-out'), sine: t('سینوسی', 'Sine'),
};

export const CrossSectionSchema = z
  .object({
    bottom: SectionSchema,
    top: SectionSchema,
    morphEnabled: bool(false, {
      fa: 'تبدیل تدریجی مقطع', en: 'Morph sections', phase: 2,
      tip: ['مقطع از شکل پایین به شکل بالا تبدیل می‌شود.', 'Blend from the bottom shape to the top shape.'],
    }),
    morphEasing: enm(EASINGS, 'easeInOut', {
      fa: 'منحنی تبدیل', en: 'Morph easing', phase: 2,
      tip: ['سرعت تبدیل در طول ارتفاع.', 'How the blend progresses with height.'], options: EASING_LABELS,
    }),
    rotationTop: num(-180, 180, 0, {
      fa: 'چرخش مقطع بالا', en: 'Top section rotation', unit: 'deg', step: 1, phase: 2,
      tip: ['چرخش شکل بالا نسبت به پایین.', 'Rotation of the top shape relative to the bottom.'],
    }),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// D) Twist, lobes, bend
// ---------------------------------------------------------------------------

export const TWIST_CURVES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'sineBackForth', 'custom'] as const;

export const CurvePointSchema = z.object({
  t: num(0, 100, 0, { fa: 'ارتفاع', en: 'Height', unit: '%', step: 0.5, tip: ['ارتفاع نقطه.', 'Point height.'] }),
  v: num(-1, 1, 0, { fa: 'مقدار', en: 'Value', unit: 'x', step: 0.01, tip: ['ضریب پیچش کل.', 'Multiplier of total twist.'] }),
});

export const TwistSchema = z
  .object({
    total: num(-720, 720, 0, {
      fa: 'پیچش کل', en: 'Total twist', unit: 'deg', step: 1, basic: true,
      tip: ['چرخش مقطع از پایین تا بالا.', 'Section rotation from base to rim.'],
    }),
    curve: enm(TWIST_CURVES, 'linear', {
      fa: 'منحنی پیچش', en: 'Twist curve',
      tip: ['نحوهٔ توزیع پیچش در ارتفاع.', 'How the twist is distributed along the height.'],
      options: { ...EASING_LABELS, sineBackForth: t('رفت‌وبرگشتی', 'Back and forth'), custom: t('سفارشی', 'Custom') },
    }),
    oscillations: num(0.5, 4, 1, {
      fa: 'تعداد رفت‌وبرگشت', en: 'Oscillations', step: 0.25,
      tip: ['فقط برای پیچش رفت‌وبرگشتی.', 'Back-and-forth cycles (sineBackForth only).'],
    }),
    customCurve: meta(
      z.array(CurvePointSchema).min(2).max(12).default([{ t: 0, v: 0 }, { t: 100, v: 1 }]),
      { fa: 'منحنی پیچش سفارشی', en: 'Custom twist curve', tip: ['نقاط منحنی پیچش.', 'Custom twist curve points.'] },
    ),
    lobes: z
      .object({
        count: int(0, 12, 0, {
          fa: 'تعداد لوب', en: 'Lobes', step: 1, basic: true,
          tip: ['برآمدگی‌های بزرگ دور بدنه.', 'Large bulges around the body.'],
        }),
        depth: num(0, 30, 10, {
          fa: 'عمق لوب', en: 'Lobe depth', unit: '%', step: 1,
          tip: ['فرورفتگی بین لوب‌ها (حداکثر ۳۰٪).', 'Valley depth between lobes (max 30 %).'],
        }),
        swirl: num(-2, 2, 0, {
          fa: 'چرخش لوب‌ها', en: 'Lobe swirl', unit: 'turns', step: 0.05,
          tip: ['چرخش اضافهٔ لوب‌ها در ارتفاع.', 'Extra rotation of the lobes along the height.'],
        }),
      })
      .prefault({}),
    bend: z
      .object({
        offset: num(-60, 60, 0, {
          fa: 'خمش محور', en: 'Axis bend', unit: 'mm', step: 0.5,
          tip: ['جابه‌جایی مرکز دهانه نسبت به کف (x = خمش·t²).', 'Rim centre offset (x = bend·t²).'],
        }),
        direction: num(0, 360, 0, {
          fa: 'جهت خمش', en: 'Bend direction', unit: 'deg', step: 1,
          tip: ['جهت خم شدن محور.', 'Direction the axis bends towards.'],
        }),
      })
      .prefault({}),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// E) Surface effect stack
// ---------------------------------------------------------------------------

const windowFields = {
  id: z.string().min(1).max(32).optional(),
  enabled: bool(true, { fa: 'فعال', en: 'Enabled', tip: ['روشن/خاموش کردن افکت.', 'Toggle this effect.'] }),
  start: pct(0, { fa: 'شروع', en: 'Start', tip: ['ارتفاع شروع افکت.', 'Height where the effect starts.'] }),
  end: pct(100, { fa: 'پایان', en: 'End', tip: ['ارتفاع پایان افکت.', 'Height where the effect ends.'] }),
  fade: pct(5, { fa: 'نرمی لبه', en: 'Fade', tip: ['محوشدن تدریجی در ابتدا و انتها.', 'Soft fade-in/out inside the window.'] }),
};

export const RIB_PROFILES = ['V', 'round', 'flat', 'softSquare'] as const;

export const RibsSchema = z.object({
  type: z.literal('ribs'),
  ...windowFields,
  count: int(0, 240, 24, { fa: 'تعداد دنده', en: 'Rib count', step: 1, basic: true, tip: ['تعداد دنده‌ها دور بدنه.', 'Ribs around the circumference.'] }),
  depth: num(0, 15, 2, { fa: 'عمق دنده', en: 'Rib depth', unit: 'mm', step: 0.1, basic: true, tip: ['ارتفاع/عمق شعاعی دنده.', 'Radial rib height/depth.'] }),
  profile: enm(RIB_PROFILES, 'round', {
    fa: 'مقطع دنده', en: 'Rib profile', tip: ['شکل مقطع هر دنده.', 'Cross-section of each rib.'],
    options: { V: t('هفتی', 'V'), round: t('گرد', 'Round'), flat: t('تخت', 'Flat'), softSquare: t('مربع نرم', 'Soft square') },
  }),
  style: enm(['raised', 'grooved'] as const, 'raised', {
    fa: 'نوع', en: 'Style', tip: ['برجسته یا شیار فرورفته (فلوت).', 'Raised ribs or cut-in flutes.'],
    options: { raised: t('برجسته', 'Raised'), grooved: t('شیاردار', 'Grooved') },
  }),
  widthRatio: num(0.1, 0.9, 0.5, { fa: 'نسبت پهنا', en: 'Width ratio', unit: 'x', step: 0.01, tip: ['سهم دنده از هر گام.', 'Fraction of each pitch covered by the rib.'] }),
  helixTurns: num(-3, 3, 0, { fa: 'دور مارپیچ', en: 'Helix turns', unit: 'turns', step: 0.05, tip: ['چرخش مارپیچ دنده‌ها در ارتفاع.', 'Helical turns over the height.'] }),
  crisscross: bool(false, { fa: 'ضربدری (مشبک)', en: 'Crisscross', tip: ['دو مارپیچ مخالف = نقش مشبک.', 'Two opposite helices = lattice look.'] }),
});

export const WavesSchema = z.object({
  type: z.literal('waves'),
  ...windowFields,
  amplitude: num(0, 10, 2, { fa: 'دامنه', en: 'Amplitude', unit: 'mm', step: 0.1, basic: true, tip: ['دامنهٔ موج.', 'Wave amplitude.'] }),
  freqZ: num(0, 40, 6, { fa: 'تعداد موج عمودی', en: 'Vertical frequency', step: 0.25, tip: ['تعداد موج در طول ارتفاع.', 'Wave cycles over the height.'] }),
  freqTheta: int(0, 60, 0, { fa: 'تعداد موج دورتادور', en: 'Circumferential frequency', step: 1, tip: ['تعداد موج دور بدنه (عدد صحیح).', 'Cycles around (integer, seamless).'] }),
  phase: num(0, 360, 0, { fa: 'فاز', en: 'Phase', unit: 'deg', step: 1, tip: ['جابه‌جایی موج.', 'Wave phase offset.'] }),
});

export const NoiseSchema = z.object({
  type: z.literal('noise'),
  ...windowFields,
  amplitude: num(0, 10, 1.5, { fa: 'دامنه', en: 'Amplitude', unit: 'mm', step: 0.1, basic: true, tip: ['شدت نویز.', 'Noise amplitude.'] }),
  scale: num(2, 100, 20, { fa: 'مقیاس', en: 'Scale', unit: 'mm', step: 0.5, tip: ['اندازهٔ تقریبی برآمدگی‌ها.', 'Feature size of the noise.'] }),
  octaves: int(1, 6, 3, { fa: 'اکتاو', en: 'Octaves', step: 1, tip: ['لایه‌های جزئیات.', 'Layers of detail.'] }),
  seed: seed(),
});

export const OrganicSchema = z.object({
  type: z.literal('organic'),
  ...windowFields,
  style: enm(['softBulges', 'silkFolds'] as const, 'softBulges', {
    fa: 'سبک', en: 'Style', phase: 2, tip: ['برآمدگی نرم یا چین ابریشمی.', 'Soft bulges or silk folds.'],
    options: { softBulges: t('برآمدگی نرم', 'Soft bulges'), silkFolds: t('چین ابریشمی', 'Silk folds') },
  }),
  amount: num(0, 10, 3, { fa: 'شدت', en: 'Amount', unit: 'mm', step: 0.1, phase: 2, tip: ['شدت جابه‌جایی.', 'Displacement amount.'] }),
  scale: num(5, 150, 40, { fa: 'مقیاس', en: 'Scale', unit: 'mm', step: 1, phase: 2, tip: ['اندازهٔ فرم‌ها.', 'Feature size.'] }),
  stretch: num(1, 12, 5, { fa: 'کشیدگی عمودی', en: 'Vertical stretch', unit: 'x', step: 0.1, phase: 2, tip: ['کشیدگی چین‌ها در ارتفاع.', 'Vertical elongation of folds.'] }),
  seed: seed({ phase: 2 }),
});

export const TEXTURE_PATTERNS = [
  'honeycomb', 'knurl', 'diamond', 'basketweave', 'chevron', 'scales', 'hammered', 'bark', 'rope', 'dots',
] as const;

export const TextureSchema = z.object({
  type: z.literal('texture'),
  ...windowFields,
  pattern: enm(TEXTURE_PATTERNS, 'honeycomb', {
    fa: 'نقش بافت', en: 'Pattern', phase: 2, tip: ['الگوی تکرارشونده و بی‌درز.', 'Seamless repeating pattern.'],
    options: {
      honeycomb: t('لانه‌زنبوری', 'Honeycomb'), knurl: t('آج', 'Knurl'), diamond: t('الماسی', 'Diamond'),
      basketweave: t('سبدبافت', 'Basketweave'), chevron: t('جناغی', 'Chevron'), scales: t('فلس', 'Scales'),
      hammered: t('چکشی', 'Hammered'), bark: t('پوست درخت', 'Bark'), rope: t('طنابی', 'Rope'), dots: t('خال‌خالی', 'Dots'),
    },
  }),
  depth: num(0, 3, 0.8, { fa: 'عمق', en: 'Depth', unit: 'mm', step: 0.05, phase: 2, tip: ['عمق بافت.', 'Texture depth.'] }),
  repeats: int(6, 240, 48, { fa: 'تراکم (تکرار دورتادور)', en: 'Density (repeats)', step: 1, phase: 2, tip: ['تعداد سلول دور بدنه.', 'Cells around the circumference.'] }),
  aspect: num(0.25, 4, 1, { fa: 'نسبت سلول', en: 'Cell aspect', unit: 'x', step: 0.05, phase: 2, tip: ['ارتفاع سلول به پهنای آن.', 'Cell height / width.'] }),
  invert: bool(false, { fa: 'معکوس', en: 'Invert', phase: 2, tip: ['برجسته ↔ فرورفته.', 'Swap raised and recessed.'] }),
  seed: seed({ phase: 2 }),
});

export const FacetsSchema = z.object({
  type: z.literal('facets'),
  ...windowFields,
  angularSegments: int(3, 48, 9, { fa: 'تقسیم دورتادور', en: 'Angular segments', step: 1, phase: 2, tip: ['تعداد وجه دور بدنه.', 'Facets around.'] }),
  verticalSegments: int(2, 40, 6, { fa: 'تقسیم عمودی', en: 'Vertical segments', step: 1, phase: 2, tip: ['تعداد ردیف وجه.', 'Facet rows.'] }),
  jitter: num(0, 5, 1.5, { fa: 'بی‌نظمی', en: 'Jitter', unit: 'mm', step: 0.1, phase: 2, tip: ['جابه‌جایی تصادفی گوشه‌ها.', 'Random vertex offset.'] }),
  seed: seed({ phase: 2 }),
});

export const StepsSchema = z.object({
  type: z.literal('steps'),
  ...windowFields,
  count: int(2, 30, 8, { fa: 'تعداد پله', en: 'Steps', step: 1, phase: 2, tip: ['تعداد طبقه‌ها.', 'Number of terraces.'] }),
  bevel: pct(50, { fa: 'پخ پله', en: 'Bevel', phase: 2, tip: ['شیب لبهٔ پله؛ پله‌های رو به بیرون باید پخ داشته باشند.', 'Step edge slope; outward steps need a bevel.'] }),
});

export const GlitchSchema = z.object({
  type: z.literal('glitch'),
  ...windowFields,
  bands: int(0, 30, 6, { fa: 'تعداد نوار', en: 'Bands', step: 1, phase: 2, tip: ['تعداد نوارهای جابه‌جاشده.', 'Number of shifted bands.'] }),
  maxOffset: num(0, 6, 2, { fa: 'بیشینهٔ جابه‌جایی', en: 'Max offset', unit: 'mm', step: 0.1, phase: 2, tip: ['جابه‌جایی شعاعی نوارها.', 'Radial band offset.'] }),
  maxShift: num(0, 45, 8, { fa: 'بیشینهٔ چرخش', en: 'Max shift', unit: 'deg', step: 0.5, phase: 2, tip: ['چرخش نوارها.', 'Angular band shift.'] }),
  seed: seed({ phase: 2 }),
});

export const DisplacementSchema = z.object({
  type: z.literal('displacement'),
  ...windowFields,
  imageId: meta(z.string().max(64).default(''), { fa: 'تصویر', en: 'Image', phase: 3, tip: ['تصویر خاکستری (روشن = برجسته).', 'Grayscale map (white = raised).'] }),
  depth: num(0, 3, 1, { fa: 'عمق', en: 'Depth', unit: 'mm', step: 0.05, phase: 3, tip: ['عمق برجستگی.', 'Displacement depth.'] }),
  tilesU: int(1, 24, 4, { fa: 'تکرار افقی', en: 'Tiles around', step: 1, phase: 3, tip: ['تکرار تصویر دور بدنه.', 'Repeats around.'] }),
  tilesV: num(0.25, 24, 2, { fa: 'تکرار عمودی', en: 'Tiles up', step: 0.25, phase: 3, tip: ['تکرار تصویر در ارتفاع.', 'Repeats along the height.'] }),
});

export const EffectSchema = z.discriminatedUnion('type', [
  RibsSchema, WavesSchema, NoiseSchema, OrganicSchema, TextureSchema,
  FacetsSchema, StepsSchema, GlitchSchema, DisplacementSchema,
]);
export type Effect = z.infer<typeof EffectSchema>;
export type EffectType = Effect['type'];
export const MAX_EFFECTS = 12;

// ---------------------------------------------------------------------------
// F) Rim
// ---------------------------------------------------------------------------

export const RimSchema = z
  .object({
    flare: num(-10, 20, 0, { fa: 'بازشدگی لبه', en: 'Rim flare', unit: 'mm', step: 0.1, tip: ['باز (مثبت) یا جمع (منفی) شدن لبه.', 'Outward (+) or inward (−) rim flare.'] }),
    flareZone: num(0, 30, 10, { fa: 'ناحیهٔ بازشدگی', en: 'Flare zone', unit: '%', step: 1, tip: ['ارتفاع ناحیهٔ بازشدگی (حداکثر ۳۰٪).', 'Height of the flare zone (max 30 %).'] }),
    lipThickness: num(0, 5, 0, { fa: 'ضخامت لب', en: 'Lip thickness', unit: 'mm', step: 0.1, tip: ['ضخیم‌تر کردن لبه (حالت پوسته).', 'Thickens the rim (shell mode).'] }),
    round: bool(true, { fa: 'لبهٔ گرد', en: 'Rounded rim', tip: ['گرد کردن لبهٔ بالایی (حالت پوسته).', 'Half-round rim (shell mode).'] }),
    ruffle: z
      .object({
        count: int(0, 24, 0, { fa: 'تعداد چین لبه', en: 'Ruffle count', step: 1, tip: ['لبهٔ کنگره‌دار؛ فقط حالت پوسته.', 'Scalloped rim; shell only.'] }),
        depth: num(0, 15, 4, { fa: 'عمق چین لبه', en: 'Ruffle depth', unit: 'mm', step: 0.1, tip: ['ارتفاع کنگره‌ها.', 'Scallop height.'] }),
      })
      .prefault({}),
    slant: z
      .object({
        height: num(0, 40, 0, { fa: 'برش مورب', en: 'Slanted cut', unit: 'mm', step: 0.5, tip: ['اختلاف ارتفاع لبه؛ فقط حالت پوسته.', 'Rim height difference; shell only.'] }),
        angle: num(0, 360, 0, { fa: 'جهت برش', en: 'Cut direction', unit: 'deg', step: 1, tip: ['جهت پایین‌ترین نقطهٔ لبه.', 'Direction of the lowest rim point.'] }),
      })
      .prefault({}),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// G) Base
// ---------------------------------------------------------------------------

export const BaseSchema = z
  .object({
    bottomThickness: num(0, 5, 2, { fa: 'ضخامت کف', en: 'Bottom thickness', unit: 'mm', step: 0.1, tip: ['ضخامت کف (در حالت گلدان = لایه‌های کف اسلایسر).', 'Floor thickness (vase mode: slicer bottom layers).'] }),
    chamfer: num(0, 5, 0.6, { fa: 'پخ کف', en: 'Base chamfer', unit: 'mm', step: 0.1, tip: ['پخ ۴۵° لبهٔ کف؛ ضد پای فیل.', '45° chamfer; prevents elephant foot.'] }),
    footRing: z
      .object({
        height: num(0, 15, 0, { fa: 'ارتفاع پایهٔ حلقه‌ای', en: 'Foot ring height', unit: 'mm', step: 0.1, tip: ['ارتفاع پایهٔ زیر بدنه.', 'Height of the foot below the body.'] }),
        inset: num(0, 10, 3, { fa: 'تورفتگی پایه', en: 'Foot inset', unit: 'mm', step: 0.1, tip: ['چقدر پایه از بدنه کوچک‌تر است.', 'How far the foot is inset from the body.'] }),
      })
      .prefault({}),
    concave: num(0, 3, 0, { fa: 'کف مقعر', en: 'Concave base', unit: 'mm', step: 0.1, tip: ['فرورفتگی وسط کف؛ فقط حالت پوسته.', 'Domed underside; shell only.'] }),
    drainageHole: num(0, 20, 0, { fa: 'سوراخ زهکشی', en: 'Drainage hole', unit: 'mm', step: 0.5, tip: ['قطر سوراخ کف؛ فقط حالت پوسته.', 'Hole diameter; shell only.'] }),
    saucer: z
      .object({
        enabled: bool(false, { fa: 'زیرگلدانی', en: 'Saucer', phase: 2, tip: ['زیرگلدانی به‌عنوان قطعهٔ جدا.', 'Separate saucer body.'] }),
        gap: num(1, 10, 3, { fa: 'فاصله', en: 'Gap', unit: 'mm', step: 0.5, phase: 2, tip: ['فاصلهٔ گلدان تا دیوارهٔ زیرگلدانی.', 'Clearance between pot and saucer wall.'] }),
        height: num(5, 40, 15, { fa: 'ارتفاع', en: 'Height', unit: 'mm', step: 0.5, phase: 2, tip: ['ارتفاع زیرگلدانی.', 'Saucer height.'] }),
        rim: num(0, 10, 2, { fa: 'لبه', en: 'Rim', unit: 'mm', step: 0.1, phase: 2, tip: ['بازشدگی لبهٔ زیرگلدانی.', 'Saucer rim flare.'] }),
      })
      .prefault({}),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// H) Output & print
// ---------------------------------------------------------------------------

export const OUTPUT_MODES = ['solidVase', 'shell', 'doubleWallVase'] as const;
export const USE_CASES = ['dryDecor', 'freshFlowers', 'indoorPlanter', 'outdoorPlanter'] as const;
export const MATERIALS = ['PLA', 'silkPLA', 'PETG', 'ASA', 'TPU'] as const;

/** Usable build volume in mm. */
export const PRINTER_PRESETS = {
  bambuA1: { name: 'Bambu Lab A1', bedX: 256, bedY: 256, bedZ: 256 },
  bambuA1mini: { name: 'Bambu Lab A1 mini', bedX: 180, bedY: 180, bedZ: 180 },
  bambuP1S: { name: 'Bambu Lab P1S', bedX: 256, bedY: 256, bedZ: 256 },
  bambuX1C: { name: 'Bambu Lab X1C', bedX: 256, bedY: 256, bedZ: 256 },
  bambuH2D: { name: 'Bambu Lab H2D (single nozzle)', bedX: 325, bedY: 320, bedZ: 325 },
  prusaMK4: { name: 'Prusa MK4', bedX: 250, bedY: 210, bedZ: 220 },
  prusaCoreOne: { name: 'Prusa Core One', bedX: 250, bedY: 220, bedZ: 270 },
  ender3: { name: 'Creality Ender-3', bedX: 220, bedY: 220, bedZ: 250 },
  crealityK1: { name: 'Creality K1', bedX: 220, bedY: 220, bedZ: 250 },
  custom: { name: 'Custom', bedX: 220, bedY: 220, bedZ: 250 },
} as const;
export type PrinterPreset = keyof typeof PRINTER_PRESETS;
const PRINTER_KEYS = Object.keys(PRINTER_PRESETS) as [PrinterPreset, ...PrinterPreset[]];

export const PrintSchema = z
  .object({
    outputMode: enm(OUTPUT_MODES, 'solidVase', {
      fa: 'حالت خروجی', en: 'Output mode', basic: true,
      tip: ['توپر برای حالت گلدان (اسپیرال)، پوسته برای چاپ معمولی.', 'Solid for spiral vase mode, shell for normal printing.'],
      options: {
        solidVase: t('توپر (حالت گلدان)', 'Solid (vase mode)'),
        shell: t('پوسته (چاپ معمولی)', 'Shell (normal print)'),
        doubleWallVase: t('دوجداره (حالت گلدان)', 'Double wall (vase mode)'),
      },
    }),
    wallThickness: num(1.2, 4, 2, { fa: 'ضخامت دیواره', en: 'Wall thickness', unit: 'mm', step: 0.05, tip: ['ضخامت دیواره در حالت پوسته؛ مضربی از پهنای خط.', 'Shell wall; snapped to multiples of line width.'] }),
    innerSurface: enm(['smoothLiner', 'follow'] as const, 'smoothLiner', {
      fa: 'سطح داخلی', en: 'Inner surface',
      tip: ['داخل صاف (بدون بافت) یا هم‌شکل با بیرون.', 'Smooth liner (no textures) or follow the outside.'],
      options: { smoothLiner: t('صاف', 'Smooth liner'), follow: t('هم‌شکل بیرون', 'Follow outside') },
    }),
    useCase: enm(USE_CASES, 'dryDecor', {
      fa: 'کاربرد', en: 'Use case', basic: true, tip: ['برای توصیه‌های آب‌بندی و زهکشی.', 'Drives watertightness and drainage advice.'],
      options: {
        dryDecor: t('تزئینی خشک', 'Dry decor'), freshFlowers: t('گل تازه (با آب)', 'Fresh flowers (water)'),
        indoorPlanter: t('گلدان گیاه داخلی', 'Indoor planter'), outdoorPlanter: t('گلدان فضای باز', 'Outdoor planter'),
      },
    }),
    printer: z
      .object({
        preset: meta(z.enum(PRINTER_KEYS).default('bambuA1'), {
          fa: 'پرینتر', en: 'Printer', basic: true, tip: ['برای بررسی ابعاد بستر و G-code.', 'Used for bed-size checks and G-code.'],
          options: Object.fromEntries(Object.entries(PRINTER_PRESETS).map(([k, v]) => [k, t(k === 'custom' ? 'سفارشی' : v.name, v.name)])),
        }),
        bedX: num(50, 1000, 220, { fa: 'طول بستر', en: 'Bed X', unit: 'mm', step: 1, tip: ['فقط پرینتر سفارشی.', 'Custom printer only.'] }),
        bedY: num(50, 1000, 220, { fa: 'عرض بستر', en: 'Bed Y', unit: 'mm', step: 1, tip: ['فقط پرینتر سفارشی.', 'Custom printer only.'] }),
        bedZ: num(50, 1000, 250, { fa: 'ارتفاع چاپ', en: 'Bed Z', unit: 'mm', step: 1, tip: ['فقط پرینتر سفارشی.', 'Custom printer only.'] }),
      })
      .prefault({}),
    nozzle: num(0.2, 1, 0.4, { fa: 'قطر نازل', en: 'Nozzle', unit: 'mm', step: 0.05, tip: ['قطر نازل پرینتر.', 'Nozzle diameter.'] }),
    lineWidth: num(0.2, 2, 0.7, { fa: 'پهنای خط', en: 'Line width', unit: 'mm', step: 0.01, tip: ['در حالت گلدان ۱.۵ تا ۲ برابر نازل.', 'Vase mode: 1.5–2× nozzle.'] }),
    layerHeight: num(0.05, 0.8, 0.24, { fa: 'ارتفاع لایه', en: 'Layer height', unit: 'mm', step: 0.01, tip: ['حداکثر ۰.۶۶ پهنای خط.', 'At most 0.66 × line width.'] }),
    material: enm(MATERIALS, 'PLA', {
      fa: 'متریال', en: 'Material', basic: true, tip: ['برای وزن، دما و توصیه‌ها.', 'Weight, temperatures and advice.'],
      options: { PLA: t('PLA', 'PLA'), silkPLA: t('PLA ابریشمی', 'Silk PLA'), PETG: t('PETG', 'PETG'), ASA: t('ASA', 'ASA'), TPU: t('TPU', 'TPU') },
    }),
    maxOverhang: num(30, 70, 45, { fa: 'بیشینهٔ زاویهٔ آویز', en: 'Max overhang', unit: 'deg', step: 1, tip: ['زاویه از عمود که پرینتر شما بدون ساپورت چاپ می‌کند.', 'Angle from vertical your printer handles unsupported.'] }),
    flow: num(90, 110, 100, { fa: 'جریان', en: 'Flow', unit: '%', step: 1, phase: 3, tip: ['ضریب اکستروژن (G-code).', 'Extrusion multiplier (G-code).'] }),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// I) Randomness   J) Render
// ---------------------------------------------------------------------------

export const RandomSchema = z
  .object({
    seed: seed({ basic: true }),
    /** Dot paths of locked parameters, e.g. "dimensions.height", "effects.0.count". */
    locks: meta(z.array(z.string().max(80)).max(256).default([]), {
      fa: 'پارامترهای قفل‌شده', en: 'Locked parameters', tip: ['تصادفی‌سازی این‌ها را تغییر نمی‌دهد.', 'Randomize leaves these untouched.'],
    }),
  })
  .prefault({});

export const QUALITIES = ['low', 'medium', 'high', 'ultra'] as const;
/** Grid resolution (Nθ × Nz) per quality level, before auto-raise. */
export const QUALITY_GRID = {
  low: { nTheta: 128, nZ: 100 },
  medium: { nTheta: 256, nZ: 200 },
  high: { nTheta: 512, nZ: 400 },
  ultra: { nTheta: 1024, nZ: 800 },
} as const;
const QUALITY_LABELS = { low: t('کم', 'Low'), medium: t('متوسط', 'Medium'), high: t('زیاد', 'High'), ultra: t('خیلی زیاد', 'Ultra') };

export const RenderSchema = z
  .object({
    previewQuality: enm(QUALITIES, 'medium', { fa: 'کیفیت پیش‌نمایش', en: 'Preview quality', tip: ['تراکم مش در نمایشگر.', 'Viewer mesh density.'], options: QUALITY_LABELS }),
    exportQuality: enm(QUALITIES, 'high', { fa: 'کیفیت خروجی', en: 'Export quality', tip: ['تراکم مش فایل خروجی.', 'Exported mesh density.'], options: QUALITY_LABELS }),
    viewMaterial: enm(['matte', 'silk', 'gloss', 'translucent'] as const, 'matte', {
      fa: 'جنس نمایش', en: 'View material', tip: ['فقط ظاهر نمایشگر.', 'Viewer appearance only.'],
      options: { matte: t('مات', 'Matte'), silk: t('ابریشمی', 'Silk'), gloss: t('براق', 'Gloss'), translucent: t('نیمه‌شفاف', 'Translucent') },
    }),
    color: meta(z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#d8c8b0'), {
      fa: 'رنگ فیلامنت', en: 'Filament colour', tip: ['رنگ نمایش.', 'Display colour.'],
    }),
  })
  .prefault({});

// ---------------------------------------------------------------------------
// Root schema + cross-field rules
// ---------------------------------------------------------------------------

function checkSortedT(points: readonly { t: number }[], path: (string | number)[], ctx: z.RefinementCtx) {
  if (points[0].t !== 0 || points[points.length - 1].t !== 100) {
    ctx.addIssue({ code: 'custom', path, message: 'First point must be at t = 0 and last at t = 100.' });
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i].t <= points[i - 1].t) {
      ctx.addIssue({ code: 'custom', path: [...path, i, 't'], message: 'Points must be strictly increasing in t.' });
    }
  }
}

export const VaseParamsSchema = z
  .object({
    version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    name: z.string().max(80).default(''),
    dimensions: DimensionsSchema,
    profile: ProfileSchema,
    section: CrossSectionSchema,
    twist: TwistSchema,
    effects: z.array(EffectSchema).max(MAX_EFFECTS).default([]),
    rim: RimSchema,
    base: BaseSchema,
    print: PrintSchema,
    random: RandomSchema,
    render: RenderSchema,
  })
  .superRefine((p, ctx) => {
    if (p.dimensions.neckPosition <= p.dimensions.bellyPosition) {
      ctx.addIssue({ code: 'custom', path: ['dimensions', 'neckPosition'], message: 'neckPosition must be above bellyPosition.' });
    }
    if (p.profile.preset === 'custom') checkSortedT(p.profile.controlPoints, ['profile', 'controlPoints'], ctx);
    if (p.twist.curve === 'custom') checkSortedT(p.twist.customCurve, ['twist', 'customCurve'], ctx);

    for (const which of ['bottom', 'top'] as const) {
      const pts = p.section[which].custom.points;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].a <= pts[i - 1].a) {
          ctx.addIssue({ code: 'custom', path: ['section', which, 'custom', 'points', i, 'a'], message: 'Polar points must be strictly increasing in angle.' });
        }
      }
      const s = p.section[which].svg.samples;
      if (s.length > 0 && s.length < 32) {
        ctx.addIssue({ code: 'custom', path: ['section', which, 'svg', 'samples'], message: 'SVG polar table needs at least 32 samples.' });
      }
    }

    const ids = new Set<string>();
    p.effects.forEach((e, i) => {
      if (e.end <= e.start) {
        ctx.addIssue({ code: 'custom', path: ['effects', i, 'end'], message: 'Effect end must be above start.' });
      } else if (e.fade > (e.end - e.start) / 2) {
        ctx.addIssue({ code: 'custom', path: ['effects', i, 'fade'], message: 'Fade must be at most half the effect window.' });
      }
      if (e.id !== undefined) {
        if (ids.has(e.id)) ctx.addIssue({ code: 'custom', path: ['effects', i, 'id'], message: 'Duplicate effect id.' });
        ids.add(e.id);
      }
    });
  });

export type VaseParams = z.infer<typeof VaseParamsSchema>;
export type VaseParamsInput = z.input<typeof VaseParamsSchema>;

/** Fully populated default design. */
export const DEFAULT_PARAMS: VaseParams = VaseParamsSchema.parse({});

/** Effective build volume for the selected printer. */
export function bedSize(print: VaseParams['print']): { bedX: number; bedY: number; bedZ: number } {
  const { preset, bedX, bedY, bedZ } = print.printer;
  return preset === 'custom' ? { bedX, bedY, bedZ } : PRINTER_PRESETS[preset];
}

/** JSON Schema handed to the LLM (input shape: defaults make every field optional). */
export function paramsJsonSchema() {
  return z.toJSONSchema(VaseParamsSchema, { io: 'input', unrepresentable: 'any' });
}
