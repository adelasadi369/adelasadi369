import { useState, type ReactNode } from 'react';
import type { VaseParams } from '../core/params/schema';
import { useStore, type TabId } from '../state/store';
import { Group, ParamControl } from './controls/ParamControl';
import { isShown } from './controls/visibility';
import { AiPanel } from './AiPanel';
import { BoreReadout, CalibrationModal } from './Calibration';
import { EffectStack } from './EffectStack';
import { useT } from './hooks';
import { PolarEditor } from './PolarEditor';
import { ProfileEditor } from './ProfileEditor';
import { SvgImportButton } from './SvgImportButton';

type Rule = (p: VaseParams) => boolean;
const NO_BELLY = ['straight', 'taper', 'concave', 'hourglass', 'flaredTrumpet'];
const NO_NECK = ['straight', 'taper', 'convex', 'teardrop', 'sphere', 'custom'];
const shell: Rule = (p) => p.print.outputMode !== 'solidVase';
const fullShell: Rule = (p) => p.print.outputMode === 'shell';
const bore: Rule = (p) => fullShell(p) && p.print.innerSurface === 'bore';
const bottomIs =
  (...kinds: VaseParams['insert']['bottom'][]): Rule =>
  (p) =>
    bore(p) && kinds.includes(p.insert.bottom);

const VISIBLE: Record<string, Rule> = {
  'dimensions.topDiameter': (p) => !['straight', 'custom'].includes(p.profile.preset),
  'dimensions.baseDiameter': (p) => p.profile.preset !== 'custom',
  'dimensions.maxDiameter': (p) => !NO_BELLY.includes(p.profile.preset),
  'dimensions.neckDiameter': (p) => !NO_NECK.includes(p.profile.preset),
  'dimensions.bellyPosition': (p) => !['straight', 'taper', 'sphere', 'hourglass', 'custom'].includes(p.profile.preset),
  'dimensions.neckPosition': (p) => !NO_NECK.includes(p.profile.preset) && p.profile.preset !== 'hourglass',
  'profile.strength': (p) => !['straight', 'taper', 'sphere', 'custom'].includes(p.profile.preset),
  'twist.oscillations': (p) => p.twist.curve === 'sineBackForth',
  'section.morphEasing': (p) => p.section.morphEnabled,
  'section.rotationTop': (p) => p.section.morphEnabled,
  'twist.curve': (p) => p.twist.total !== 0,
  'twist.lobes.depth': (p) => p.twist.lobes.count > 0,
  'twist.lobes.swirl': (p) => p.twist.lobes.count > 0,
  'twist.bend.direction': (p) => p.twist.bend.offset !== 0,
  'rim.flareZone': (p) => p.rim.flare !== 0,
  'rim.lipThickness': (p) => shell(p) && !bore(p),
  'rim.round': shell,
  'base.bottomThickness': (p) => !bore(p),
  'base.footRing.inset': (p) => p.base.footRing.height > 0,
  'print.wallThickness': (p) => shell(p) && !bore(p),
  'print.innerSurface': (p) => p.print.outputMode === 'shell',
  'rim.ruffle.count': fullShell,
  'rim.ruffle.depth': (p) => fullShell(p) && p.rim.ruffle.count > 0,
  'rim.slant.height': fullShell,
  'rim.slant.angle': (p) => fullShell(p) && p.rim.slant.height > 0,
  'base.concave': (p) => fullShell(p) && !bore(p),
  'base.drainageHole': (p) => fullShell(p) && !bore(p),
  'base.saucer.gap': (p) => p.base.saucer.enabled,
  'base.saucer.height': (p) => p.base.saucer.enabled,
  'base.saucer.rim': (p) => p.base.saucer.enabled,
  'print.printer.bedX': (p) => p.print.printer.preset === 'custom',
  'print.printer.bedY': (p) => p.print.printer.preset === 'custom',
  'print.printer.bedZ': (p) => p.print.printer.preset === 'custom',
  'print.printer.holeCompensation': bore,
  'insert.lipWidth': bottomIs('lip'),
  'insert.lipThickness': bottomIs('lip'),
  'insert.floorThickness': bottomIs('floor', 'drain'),
  'insert.drainDiameter': bottomIs('drain'),
  'insert.bottomChamfer': bottomIs('open', 'lip'),
  'insert.ribs.width': (p) => bore(p) && p.insert.ribs.count > 0,
  'insert.ribs.interference': (p) => bore(p) && p.insert.ribs.count > 0,
  'insert.ribs.heightFraction': (p) => bore(p) && p.insert.ribs.count > 0,
  'insert.grooves.width': (p) => bore(p) && p.insert.grooves.count > 0,
  'insert.grooves.depth': (p) => bore(p) && p.insert.grooves.count > 0,
  'insert.grooves.z1': (p) => bore(p) && p.insert.grooves.count > 0,
  'insert.grooves.z2': (p) => bore(p) && p.insert.grooves.count > 1,
};

/** Every insert control is bore-only unless a rule above narrows it further. */
const INSERT_PATHS = [
  'insert.type',
  'insert.od',
  'insert.odTolerance',
  'insert.fit',
  'insert.clearance',
  'insert.coreWall',
  'insert.length',
  'insert.protrusion',
  'insert.bottom',
  'insert.lipWidth',
  'insert.lipThickness',
  'insert.floorThickness',
  'insert.drainDiameter',
  'insert.bottomChamfer',
  'insert.entryChamfer',
  'insert.ribs.count',
  'insert.ribs.width',
  'insert.ribs.interference',
  'insert.ribs.heightFraction',
  'insert.grooves.count',
  'insert.grooves.width',
  'insert.grooves.depth',
  'insert.grooves.z1',
  'insert.grooves.z2',
];
for (const path of INSERT_PATHS) VISIBLE[path] ??= bore;

/** Basic-mode controls that are always shown regardless of their schema level. */
const BASIC_EXTRA = new Set([
  'section.bottom.starPoints',
  'section.bottom.petals',
  'section.top.starPoints',
  'section.top.petals',
]);

/** Section fields shown per shape (bottom and top share the rules). */
const SHAPE_FIELDS: Record<string, string[]> = {
  polygon: ['sides', 'cornerRadius'],
  star: ['starPoints', 'starInnerRatio'],
  flower: ['petals', 'petalDepth'],
  superellipse: ['superellipseExponent'],
  supershape: ['supershape.m', 'supershape.n1', 'supershape.n2', 'supershape.n3', 'supershape.a', 'supershape.b'],
  custom: ['custom.symmetry', 'custom.mirror'],
};
const ALL_SHAPE_FIELDS = new Set(Object.values(SHAPE_FIELDS).flat());

function ruleFor(path: string): Rule | undefined {
  if (VISIBLE[path]) return VISIBLE[path];
  const m = /^section\.(bottom|top)\.(.+)$/.exec(path);
  if (m && ALL_SHAPE_FIELDS.has(m[2])) {
    const [, which, field] = m;
    return (p) => (SHAPE_FIELDS[p.section[which as 'bottom' | 'top'].shape] ?? []).includes(field);
  }
  return undefined;
}

function useVisible(paths: string[]) {
  const params = useStore((s) => s.params);
  const level = useStore((s) => s.level);
  return paths.filter((p) => (ruleFor(p)?.(params) ?? true) && isShown(p, level, undefined, BASIC_EXTRA.has(p)));
}

function Params({ paths }: { paths: string[] }) {
  return (
    <>
      {useVisible(paths).map((p) => (
        <ParamControl key={p} path={p} force={BASIC_EXTRA.has(p)} />
      ))}
    </>
  );
}

/** Group of params that disappears when none of its controls are visible. */
function ParamGroup({ title, paths }: { title: string; paths: string[] }) {
  const visible = useVisible(paths);
  if (!visible.length) return null;
  return (
    <Group title={title}>
      <Params paths={visible} />
    </Group>
  );
}

function ShapePanel() {
  const t = useT();
  return (
    <>
      <Group title={t('group.profile')}>
        <Params paths={['profile.preset']} />
        <ProfileEditor />
        <Params paths={['profile.strength', 'profile.waveCycles', 'profile.waveAmplitude']} />
      </Group>
      <ParamGroup
        title={t('group.dimensions')}
        paths={[
          'dimensions.height',
          'dimensions.baseDiameter',
          'dimensions.topDiameter',
          'dimensions.maxDiameter',
          'dimensions.neckDiameter',
          'dimensions.bellyPosition',
          'dimensions.neckPosition',
        ]}
      />
    </>
  );
}

const SECTION = ['shape', ...ALL_SHAPE_FIELDS, 'aspectXY'];

function SectionPanel() {
  const t = useT();
  const morph = useStore((s) => s.params.section.morphEnabled);
  const [which, setWhich] = useState<'bottom' | 'top'>('bottom');
  const w = morph ? which : 'bottom';
  const shape = useStore((s) => s.params.section[w].shape);
  return (
    <>
      <Group title={t('group.morph')}>
        <Params paths={['section.morphEnabled', 'section.morphEasing', 'section.rotationTop']} />
      </Group>
      <Group title={t('group.section')}>
        {morph && (
          <div className="mb-2 flex gap-1 rounded-lg border border-line p-0.5 text-xs">
            {(['bottom', 'top'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setWhich(k)}
                className={`flex-1 rounded-md py-1 ${w === k ? 'bg-ink text-white' : 'text-muted'}`}
              >
                {t(`section.${k}`)}
              </button>
            ))}
          </div>
        )}
        <Params key={w} paths={SECTION.map((k) => `section.${w}.${k}`)} />
        {shape === 'custom' && <PolarEditor which={w} />}
        {shape === 'svg' && <SvgImportButton which={w} />}
      </Group>
    </>
  );
}

function TwistPanel() {
  const t = useT();
  return (
    <>
      <ParamGroup title={t('group.twist')} paths={['twist.total', 'twist.curve', 'twist.oscillations']} />
      <ParamGroup title={t('group.lobes')} paths={['twist.lobes.count', 'twist.lobes.depth', 'twist.lobes.swirl']} />
      <ParamGroup title={t('group.bend')} paths={['twist.bend.offset', 'twist.bend.direction']} />
    </>
  );
}

function RimBasePanel() {
  const t = useT();
  return (
    <>
      <ParamGroup
        title={t('group.rim')}
        paths={[
          'rim.flare',
          'rim.flareZone',
          'rim.lipThickness',
          'rim.round',
          'rim.ruffle.count',
          'rim.ruffle.depth',
          'rim.slant.height',
          'rim.slant.angle',
        ]}
      />
      <ParamGroup
        title={t('group.base')}
        paths={[
          'base.bottomThickness',
          'base.chamfer',
          'base.footRing.height',
          'base.footRing.inset',
          'base.concave',
          'base.drainageHole',
        ]}
      />
      <ParamGroup
        title={t('group.saucer')}
        paths={['base.saucer.enabled', 'base.saucer.gap', 'base.saucer.height', 'base.saucer.rim']}
      />
    </>
  );
}

function CalibrateButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 rounded-lg border border-line bg-card px-3 py-1.5 text-xs hover:border-accent"
      >
        ⌀ {t('insert.calibrate')}
      </button>
      {open && <CalibrationModal onClose={() => setOpen(false)} />}
    </>
  );
}

/** Shell bore liner: tube insert, bore readout, OD measuring hint, calibration. */
function InsertGroup() {
  const t = useT();
  const on = useStore((s) => bore(s.params));
  if (!on) return null;
  return (
    <Group title={t('group.insert')}>
      <BoreReadout />
      <Params paths={['insert.type', 'insert.od']} />
      <p className="-mt-0.5 mb-1 text-[11px] leading-4 text-muted">{t('insert.odHint')}</p>
      <Params paths={INSERT_PATHS.slice(2)} />
      <CalibrateButton />
    </Group>
  );
}

function PrintPanel() {
  const t = useT();
  return (
    <>
      <ParamGroup
        title={t('group.output')}
        paths={['print.outputMode', 'print.wallThickness', 'print.innerSurface', 'print.useCase', 'print.material']}
      />
      <InsertGroup />
      <ParamGroup
        title={t('group.printer')}
        paths={[
          'print.printer.preset',
          'print.printer.bedX',
          'print.printer.bedY',
          'print.printer.bedZ',
          'print.printer.holeCompensation',
          'print.nozzle',
          'print.lineWidth',
          'print.layerHeight',
          'print.maxOverhang',
        ]}
      />
      <ParamGroup title={t('group.render')} paths={['render.previewQuality', 'render.exportQuality']} />
    </>
  );
}

const PANELS: Record<TabId, () => ReactNode> = {
  shape: ShapePanel,
  section: SectionPanel,
  twist: TwistPanel,
  surface: EffectStack,
  rimBase: RimBasePanel,
  print: PrintPanel,
  ai: AiPanel,
};

export function TabPanel({ tab }: { tab: TabId }) {
  const P = PANELS[tab];
  return <P />;
}
