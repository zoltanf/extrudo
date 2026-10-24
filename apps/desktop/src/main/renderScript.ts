/**
 * The Blender script Render Picture runs (P6-15, ADR-0101 §3), bundled as
 * text so main can write it next to the model it renders. The script lives in
 * `apps/desktop/blender/render.py` where it can be run by hand against a
 * Blender on PATH; this module only carries it.
 */
import renderScript from '../../blender/render.py?raw';

export default renderScript;
