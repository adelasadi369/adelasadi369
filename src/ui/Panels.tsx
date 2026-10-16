import type { ReactNode } from 'react';
import type { VaseParams } from '../core/params/schema';
import { useStore, type TabId } from '../state/store';
import { Group, ParamControl } from './controls/ParamControl';
import { isShown } from './controls/visibility';
import { EffectStack } from './EffectStack';
import { useT } from './hooks';
import { ProfileEditor } from './ProfileEditor';

type Rule = (p: VaseParams) => boolean;
const NO_BELLY = ['straight', 'taper', 'concave', 'hourglass', 'flaredTrumpet'];
const NO_NECK = ['straight', 'taper', 'convex', 'teardrop', 'sphere', 'custom'];
const shell: Rule = (p) => p.print.outputMode !== 'solidVase';

const VISIBLE: Record<string, Rule> = {
  'dimensions.topDiameter': (p) => !['straight', 'custom'].includes(p.profile.preset),
  'dimensions.baseDiameter': (p) => p.profile.preset !== 'custom',
  'dimensions.maxDiameter': (p) => !NO_BELLY.includes(p.profile.preset),
  'dimensions.neckDiameter': (p) => !NO_NECK.includes(p.profile.preset),
  'dimensions.bellyPosition': (p) => !['straight', 'taper', 'sphere', 'hourglass', 'custom'].includes(p.profile.preset),
  'dimensions.neckPosition': (p) => !NO_NECK.includes(p.profile.preset) && p.profile.preset !== 'hourglass',
  'profile.strength': (p) => !['straight', 'taper', 'sphere', 'custom'].includes(p.profile.preset),
  'section.bottom.sides': (p) => p.section.bottom.shape === 'polygon',
  'section.bottom.cornerRadius': (p) => p.section.bottom.shape === 'polygon',
  'section.bottom.starPoints': (p) => p.section.bottom.shape === 'star',
  'section.bottom.starInnerRatio': (p) => p.section.bottom.shape === 'star',
  'section.bottom.petals': (p) => p.section.bottom.shape === 'flower',
  'section.bottom.petalDepth': (p) => p.section.bottom.shape === 'flower',
  'section.bottom.superellipseExponent': (p) => p.section.bottom.shape === 'superellipse',
  'twist.oscillations': (p) => p.twist.curve === 'sineBackForth',
  'twist.curve': (p) => p.twist.total !== 0,
  'twist.lobes.depth': (p) => p.twist.lobes.count > 0,
  'twist.lobes.swirl': (p) => p.twist.lobes.count > 0,
  'twist.bend.direction': (p) => p.twist.bend.offset !== 0,
  'rim.flareZone': (p) => p.rim.flare !== 0,
  'rim.lipThickness': shell,
  'rim.round': shell,
  'base.bottomThickness': () => true,
  'base.footRing.inset': (p) => p.base.footRing.height > 0,
  'print.wallThickness': shell,
  'print.printer.bedX': (p) => p.print.printer.preset === 'custom',
  'print.printer.bedY': (p) => p.print.printer.preset === 'custom',
  'print.printer.bedZ': (p) => p.print.printer.preset === 'custom',
};

/** Basic-mode controls that are always shown regardless of their schema level. */
const BASIC_EXTRA = new Set(['section.bottom.starPoints', 'section.bottom.petals']);

function useVisible(paths: string[]) {
  const params = useStore((s) => s.params);
  const level = useStore((s) => s.level);
  return paths.filter(
    (p) => (VISIBLE[p] ? VISIBLE[p](params) : true) && isShown(p, level, undefined, BASIC_EXTRA.has(p)),
  );
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

const SECTION = [
  'shape',
  'sides',
  'cornerRadius',
  'starPoints',
  'starInnerRatio',
  'petals',
  'petalDepth',
  'superellipseExponent',
  'aspectXY',
];

function SectionPanel() {
  return <ParamGroup title={useT()('group.section')} paths={SECTION.map((k) => `section.bottom.${k}`)} />;
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
        paths={['rim.flare', 'rim.flareZone', 'rim.lipThickness', 'rim.round', 'rim.ruffle.count', 'rim.slant.height']}
      />
      <ParamGroup
        title={t('group.base')}
        paths={[
          'base.bottomThickness',
          'base.chamfer',
          'base.footRing.height',
          'base.footRing.inset',
          'base.drainageHole',
        ]}
      />
    </>
  );
}

function PrintPanel() {
  const t = useT();
  return (
    <>
      <ParamGroup
        title={t('group.output')}
        paths={['print.outputMode', 'print.wallThickness', 'print.useCase', 'print.material']}
      />
      <ParamGroup
        title={t('group.printer')}
        paths={[
          'print.printer.preset',
          'print.printer.bedX',
          'print.printer.bedY',
          'print.printer.bedZ',
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

function AiPanel() {
  return (
    <div className="p-6 text-sm leading-7 text-muted">
      <div className="mb-3 text-3xl">✦</div>
      {useT()('ai.soon')}
    </div>
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
