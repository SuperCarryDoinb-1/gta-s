# Authored swimming animations

Author: **Quaternius** (Universal Animation Library). License: **CC0 1.0**, included in `LICENSE.txt`.

- Official pack: https://quaternius.com/packs/universalanimationlibrary.html
- Author's download page: https://quaternius.itch.io/universal-animation-library
- Unmodified free Standard glTF mirror used for extraction: https://github.com/J-Ponzo/gltf-universal-animation-library
- Source files: `glTF/AnimationLibrary_Godot_Standard.gltf` and `.bin` (2025-06-10 Standard edition).

`swimming.json` contains the rig hierarchy and the original `A_TPose`, `Swim_Fwd_Loop`, and `Swim_Idle_Loop` keyframes. Mesh data, unused animation clips, finger tracks, constant scale tracks and redundant constant samples were removed. The original binary SHA-256 is stored in the JSON. No swimming motion was synthesized by the extraction script.

Runtime `src/core/SwimAnimations.ts` matches source and target reference frames, preserves target bone lengths, transfers full-body rotations, keeps physical root travel in the game controller, and follows the imported characters' separate IK foot bones to their animated ankles. Forward swimming uses the authored breaststroke; idle uses the authored tread-water cycle.

Extraction: place the original files and mirror LICENSE in `scratchpad/animation-source/`, then run `node tools/extract-swimming.mjs`. Only this small extracted JSON and the license ship with the game.
