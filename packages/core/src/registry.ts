/**
 * Every feature definition core knows (ADR-0024): one `FeatureRegistry` of
 * the pure parts — type, label, category, icon, inputs schema.
 *
 * The kernel registers the same types with an `evaluate` each
 * (`kernelFeatures()`) and the web app with a dialog spec each
 * (`featureDialogs()`); this registry is what checks a document's features
 * without either, so `@extrudo/api` can validate inputs, report issues and
 * generate its methods from one list (ADR-0068 §3).
 *
 * Adding a feature means registering it here too, with the kernel and the app.
 */
import { canvasFeature } from './canvas';
import { chamferFeature } from './chamfer';
import { coilFeature } from './coil';
import { combineFeature } from './combine';
import { CONSTRUCTION_FEATURES, CONSTRUCTION_TYPES } from './construction';
import { draftFeature } from './draft';
import { embossFeature } from './emboss';
import { extrudeFeature } from './extrude';
import { type FeatureDefinition, FeatureRegistry } from './features';
import { filletFeature } from './fillet';
import { holeFeature } from './hole';
import { importFeature } from './import';
import { loftFeature } from './loft';
import { mirrorFeature } from './mirror';
import { moveBodiesFeature } from './move';
import { offsetFaceFeature } from './offset-face';
import { circularPatternFeature, pathPatternFeature, rectangularPatternFeature } from './pattern';
import { placeOnBedFeature } from './place-on-bed';
import { pluginFeature } from './plugin-feature';
import { PRIMITIVE_FEATURES, PRIMITIVE_TYPES } from './primitives';
import { removeBodiesFeature } from './remove';
import { revolveFeature } from './revolve';
import { ribFeature } from './rib';
import { scaleFeature } from './scale';
import { scriptFeature } from './script';
import { shellFeature } from './shell';
import { sketchFeature } from './sketch/feature';
import { splitBodyFeature } from './split-body';
import { sweepFeature } from './sweep';
import { threadFeature } from './thread';

/**
 * The definitions, in the order features are first offered: creation, then
 * modification, then construction.
 */
export function documentFeatures(): FeatureRegistry<FeatureDefinition> {
  const registry = new FeatureRegistry<FeatureDefinition>()
    .register(sketchFeature)
    .register(extrudeFeature)
    .register(revolveFeature)
    .register(filletFeature)
    .register(chamferFeature)
    .register(shellFeature)
    .register(removeBodiesFeature as FeatureDefinition);
  // Box, cylinder, sphere and torus (P2-10, ADR-0032).
  for (const type of PRIMITIVE_TYPES) {
    registry.register(PRIMITIVE_FEATURES[type] as FeatureDefinition);
  }
  // Construction planes, axes and points (P3-05, ADR-0040).
  for (const type of CONSTRUCTION_TYPES) {
    registry.register(CONSTRUCTION_FEATURES[type] as FeatureDefinition);
  }
  // Combine, Move/Copy and Mirror (P3-06, ADR-0044).
  registry.register(combineFeature).register(moveBodiesFeature).register(mirrorFeature);
  // Place on Bed (P3-10, ADR-0048).
  registry.register(placeOnBedFeature);
  // Rectangular, circular and path patterns (P3-07, ADR-0047).
  registry
    .register(rectangularPatternFeature)
    .register(circularPatternFeature)
    .register(pathPatternFeature);
  // Hole (P3-04, ADR-0049).
  registry.register(holeFeature);
  // Offset Face (P3-08, ADR-0051).
  registry.register(offsetFaceFeature);
  // Split Body, Scale and Draft (P3-08, second half).
  registry.register(splitBodyFeature).register(scaleFeature).register(draftFeature);
  // Sweep, loft and coil (P4-01, ADR-0055).
  registry.register(sweepFeature).register(loftFeature).register(coilFeature);
  // Thread (P4-02, ADR-0056).
  registry.register(threadFeature);
  // Emboss and deboss (P4-04, ADR-0060).
  registry.register(embossFeature);
  // Rib (P4-10, ADR-0064 §1).
  registry.register(ribFeature);
  // Import (a STEP solid or a mesh body) and Canvas (a picture on a plane),
  // ADR-0066.
  registry.register(importFeature).register(canvasFeature);
  // Script (P5-02, ADR-0070): code that adds features, run by the kernel.
  registry.register(scriptFeature as FeatureDefinition);
  // A plugin's custom feature (P6-03, ADR-0077 §3): a Script packaged with inputs.
  registry.register(pluginFeature as unknown as FeatureDefinition);
  return registry;
}
