---
title: Chamfer
type: chamfer
section: Features
category: modify
order: 4
---

# Chamfer

`d.chamfer(inputs?, options?): FeatureHandle<'chamfer'>`

One feature of the timeline, in the **modify** category. Its name follows
the app's (`Chamfer1`, then `Chamfer2`, …); `options.name` gives it
another, `options.id` its ID and `options.index` its place in the timeline. Inputs the
table calls optional keep the default it names, so a call with none of them still makes
a valid feature.

## Inputs

| Input | Type | Required or default | What it does |
| --- | --- | --- | --- |
| `edges` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 1's edges to chamfer. A set with no edges does nothing. |
| `mode` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 1's sizes: equal distance, two distances, or distance and angle. |
| `distance` | `string \| number \| ParameterHandle` | optional | Set 1's first distance, along the face that takes it; a length. |
| `distanceB` | `string \| number \| ParameterHandle` | optional | Set 1's second distance, with two-distances; a length. |
| `angle` | `string \| number \| ParameterHandle` | optional | Set 1's angle to the first distance, with distance-angle; an angle. |
| `flip` | `boolean` | default `false` | Set 1's first distance goes on the other face. |
| `face` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges2` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 2's edges to chamfer. A set with no edges does nothing. |
| `mode2` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 2's sizes: equal distance, two distances, or distance and angle. |
| `distance2` | `string \| number \| ParameterHandle` | optional | Set 2's first distance, along the face that takes it; a length. |
| `distanceB2` | `string \| number \| ParameterHandle` | optional | Set 2's second distance, with two-distances; a length. |
| `angle2` | `string \| number \| ParameterHandle` | optional | Set 2's angle to the first distance, with distance-angle; an angle. |
| `flip2` | `boolean` | default `false` | Set 2's first distance goes on the other face. |
| `face2` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges3` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 3's edges to chamfer. A set with no edges does nothing. |
| `mode3` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 3's sizes: equal distance, two distances, or distance and angle. |
| `distance3` | `string \| number \| ParameterHandle` | optional | Set 3's first distance, along the face that takes it; a length. |
| `distanceB3` | `string \| number \| ParameterHandle` | optional | Set 3's second distance, with two-distances; a length. |
| `angle3` | `string \| number \| ParameterHandle` | optional | Set 3's angle to the first distance, with distance-angle; an angle. |
| `flip3` | `boolean` | default `false` | Set 3's first distance goes on the other face. |
| `face3` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges4` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 4's edges to chamfer. A set with no edges does nothing. |
| `mode4` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 4's sizes: equal distance, two distances, or distance and angle. |
| `distance4` | `string \| number \| ParameterHandle` | optional | Set 4's first distance, along the face that takes it; a length. |
| `distanceB4` | `string \| number \| ParameterHandle` | optional | Set 4's second distance, with two-distances; a length. |
| `angle4` | `string \| number \| ParameterHandle` | optional | Set 4's angle to the first distance, with distance-angle; an angle. |
| `flip4` | `boolean` | default `false` | Set 4's first distance goes on the other face. |
| `face4` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges5` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 5's edges to chamfer. A set with no edges does nothing. |
| `mode5` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 5's sizes: equal distance, two distances, or distance and angle. |
| `distance5` | `string \| number \| ParameterHandle` | optional | Set 5's first distance, along the face that takes it; a length. |
| `distanceB5` | `string \| number \| ParameterHandle` | optional | Set 5's second distance, with two-distances; a length. |
| `angle5` | `string \| number \| ParameterHandle` | optional | Set 5's angle to the first distance, with distance-angle; an angle. |
| `flip5` | `boolean` | default `false` | Set 5's first distance goes on the other face. |
| `face5` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges6` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 6's edges to chamfer. A set with no edges does nothing. |
| `mode6` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 6's sizes: equal distance, two distances, or distance and angle. |
| `distance6` | `string \| number \| ParameterHandle` | optional | Set 6's first distance, along the face that takes it; a length. |
| `distanceB6` | `string \| number \| ParameterHandle` | optional | Set 6's second distance, with two-distances; a length. |
| `angle6` | `string \| number \| ParameterHandle` | optional | Set 6's angle to the first distance, with distance-angle; an angle. |
| `flip6` | `boolean` | default `false` | Set 6's first distance goes on the other face. |
| `face6` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges7` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 7's edges to chamfer. A set with no edges does nothing. |
| `mode7` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 7's sizes: equal distance, two distances, or distance and angle. |
| `distance7` | `string \| number \| ParameterHandle` | optional | Set 7's first distance, along the face that takes it; a length. |
| `distanceB7` | `string \| number \| ParameterHandle` | optional | Set 7's second distance, with two-distances; a length. |
| `angle7` | `string \| number \| ParameterHandle` | optional | Set 7's angle to the first distance, with distance-angle; an angle. |
| `flip7` | `boolean` | default `false` | Set 7's first distance goes on the other face. |
| `face7` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges8` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 8's edges to chamfer. A set with no edges does nothing. |
| `mode8` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 8's sizes: equal distance, two distances, or distance and angle. |
| `distance8` | `string \| number \| ParameterHandle` | optional | Set 8's first distance, along the face that takes it; a length. |
| `distanceB8` | `string \| number \| ParameterHandle` | optional | Set 8's second distance, with two-distances; a length. |
| `angle8` | `string \| number \| ParameterHandle` | optional | Set 8's angle to the first distance, with distance-angle; an angle. |
| `flip8` | `boolean` | default `false` | Set 8's first distance goes on the other face. |
| `face8` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges9` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 9's edges to chamfer. A set with no edges does nothing. |
| `mode9` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 9's sizes: equal distance, two distances, or distance and angle. |
| `distance9` | `string \| number \| ParameterHandle` | optional | Set 9's first distance, along the face that takes it; a length. |
| `distanceB9` | `string \| number \| ParameterHandle` | optional | Set 9's second distance, with two-distances; a length. |
| `angle9` | `string \| number \| ParameterHandle` | optional | Set 9's angle to the first distance, with distance-angle; an angle. |
| `flip9` | `boolean` | default `false` | Set 9's first distance goes on the other face. |
| `face9` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges10` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 10's edges to chamfer. A set with no edges does nothing. |
| `mode10` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 10's sizes: equal distance, two distances, or distance and angle. |
| `distance10` | `string \| number \| ParameterHandle` | optional | Set 10's first distance, along the face that takes it; a length. |
| `distanceB10` | `string \| number \| ParameterHandle` | optional | Set 10's second distance, with two-distances; a length. |
| `angle10` | `string \| number \| ParameterHandle` | optional | Set 10's angle to the first distance, with distance-angle; an angle. |
| `flip10` | `boolean` | default `false` | Set 10's first distance goes on the other face. |
| `face10` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges11` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 11's edges to chamfer. A set with no edges does nothing. |
| `mode11` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 11's sizes: equal distance, two distances, or distance and angle. |
| `distance11` | `string \| number \| ParameterHandle` | optional | Set 11's first distance, along the face that takes it; a length. |
| `distanceB11` | `string \| number \| ParameterHandle` | optional | Set 11's second distance, with two-distances; a length. |
| `angle11` | `string \| number \| ParameterHandle` | optional | Set 11's angle to the first distance, with distance-angle; an angle. |
| `flip11` | `boolean` | default `false` | Set 11's first distance goes on the other face. |
| `face11` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges12` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 12's edges to chamfer. A set with no edges does nothing. |
| `mode12` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 12's sizes: equal distance, two distances, or distance and angle. |
| `distance12` | `string \| number \| ParameterHandle` | optional | Set 12's first distance, along the face that takes it; a length. |
| `distanceB12` | `string \| number \| ParameterHandle` | optional | Set 12's second distance, with two-distances; a length. |
| `angle12` | `string \| number \| ParameterHandle` | optional | Set 12's angle to the first distance, with distance-angle; an angle. |
| `flip12` | `boolean` | default `false` | Set 12's first distance goes on the other face. |
| `face12` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges13` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 13's edges to chamfer. A set with no edges does nothing. |
| `mode13` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 13's sizes: equal distance, two distances, or distance and angle. |
| `distance13` | `string \| number \| ParameterHandle` | optional | Set 13's first distance, along the face that takes it; a length. |
| `distanceB13` | `string \| number \| ParameterHandle` | optional | Set 13's second distance, with two-distances; a length. |
| `angle13` | `string \| number \| ParameterHandle` | optional | Set 13's angle to the first distance, with distance-angle; an angle. |
| `flip13` | `boolean` | default `false` | Set 13's first distance goes on the other face. |
| `face13` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges14` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 14's edges to chamfer. A set with no edges does nothing. |
| `mode14` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 14's sizes: equal distance, two distances, or distance and angle. |
| `distance14` | `string \| number \| ParameterHandle` | optional | Set 14's first distance, along the face that takes it; a length. |
| `distanceB14` | `string \| number \| ParameterHandle` | optional | Set 14's second distance, with two-distances; a length. |
| `angle14` | `string \| number \| ParameterHandle` | optional | Set 14's angle to the first distance, with distance-angle; an angle. |
| `flip14` | `boolean` | default `false` | Set 14's first distance goes on the other face. |
| `face14` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges15` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 15's edges to chamfer. A set with no edges does nothing. |
| `mode15` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 15's sizes: equal distance, two distances, or distance and angle. |
| `distance15` | `string \| number \| ParameterHandle` | optional | Set 15's first distance, along the face that takes it; a length. |
| `distanceB15` | `string \| number \| ParameterHandle` | optional | Set 15's second distance, with two-distances; a length. |
| `angle15` | `string \| number \| ParameterHandle` | optional | Set 15's angle to the first distance, with distance-angle; an angle. |
| `flip15` | `boolean` | default `false` | Set 15's first distance goes on the other face. |
| `face15` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges16` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 16's edges to chamfer. A set with no edges does nothing. |
| `mode16` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 16's sizes: equal distance, two distances, or distance and angle. |
| `distance16` | `string \| number \| ParameterHandle` | optional | Set 16's first distance, along the face that takes it; a length. |
| `distanceB16` | `string \| number \| ParameterHandle` | optional | Set 16's second distance, with two-distances; a length. |
| `angle16` | `string \| number \| ParameterHandle` | optional | Set 16's angle to the first distance, with distance-angle; an angle. |
| `flip16` | `boolean` | default `false` | Set 16's first distance goes on the other face. |
| `face16` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges17` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 17's edges to chamfer. A set with no edges does nothing. |
| `mode17` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 17's sizes: equal distance, two distances, or distance and angle. |
| `distance17` | `string \| number \| ParameterHandle` | optional | Set 17's first distance, along the face that takes it; a length. |
| `distanceB17` | `string \| number \| ParameterHandle` | optional | Set 17's second distance, with two-distances; a length. |
| `angle17` | `string \| number \| ParameterHandle` | optional | Set 17's angle to the first distance, with distance-angle; an angle. |
| `flip17` | `boolean` | default `false` | Set 17's first distance goes on the other face. |
| `face17` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges18` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 18's edges to chamfer. A set with no edges does nothing. |
| `mode18` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 18's sizes: equal distance, two distances, or distance and angle. |
| `distance18` | `string \| number \| ParameterHandle` | optional | Set 18's first distance, along the face that takes it; a length. |
| `distanceB18` | `string \| number \| ParameterHandle` | optional | Set 18's second distance, with two-distances; a length. |
| `angle18` | `string \| number \| ParameterHandle` | optional | Set 18's angle to the first distance, with distance-angle; an angle. |
| `flip18` | `boolean` | default `false` | Set 18's first distance goes on the other face. |
| `face18` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges19` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 19's edges to chamfer. A set with no edges does nothing. |
| `mode19` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 19's sizes: equal distance, two distances, or distance and angle. |
| `distance19` | `string \| number \| ParameterHandle` | optional | Set 19's first distance, along the face that takes it; a length. |
| `distanceB19` | `string \| number \| ParameterHandle` | optional | Set 19's second distance, with two-distances; a length. |
| `angle19` | `string \| number \| ParameterHandle` | optional | Set 19's angle to the first distance, with distance-angle; an angle. |
| `flip19` | `boolean` | default `false` | Set 19's first distance goes on the other face. |
| `face19` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges20` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 20's edges to chamfer. A set with no edges does nothing. |
| `mode20` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 20's sizes: equal distance, two distances, or distance and angle. |
| `distance20` | `string \| number \| ParameterHandle` | optional | Set 20's first distance, along the face that takes it; a length. |
| `distanceB20` | `string \| number \| ParameterHandle` | optional | Set 20's second distance, with two-distances; a length. |
| `angle20` | `string \| number \| ParameterHandle` | optional | Set 20's angle to the first distance, with distance-angle; an angle. |
| `flip20` | `boolean` | default `false` | Set 20's first distance goes on the other face. |
| `face20` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges21` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 21's edges to chamfer. A set with no edges does nothing. |
| `mode21` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 21's sizes: equal distance, two distances, or distance and angle. |
| `distance21` | `string \| number \| ParameterHandle` | optional | Set 21's first distance, along the face that takes it; a length. |
| `distanceB21` | `string \| number \| ParameterHandle` | optional | Set 21's second distance, with two-distances; a length. |
| `angle21` | `string \| number \| ParameterHandle` | optional | Set 21's angle to the first distance, with distance-angle; an angle. |
| `flip21` | `boolean` | default `false` | Set 21's first distance goes on the other face. |
| `face21` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges22` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 22's edges to chamfer. A set with no edges does nothing. |
| `mode22` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 22's sizes: equal distance, two distances, or distance and angle. |
| `distance22` | `string \| number \| ParameterHandle` | optional | Set 22's first distance, along the face that takes it; a length. |
| `distanceB22` | `string \| number \| ParameterHandle` | optional | Set 22's second distance, with two-distances; a length. |
| `angle22` | `string \| number \| ParameterHandle` | optional | Set 22's angle to the first distance, with distance-angle; an angle. |
| `flip22` | `boolean` | default `false` | Set 22's first distance goes on the other face. |
| `face22` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges23` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 23's edges to chamfer. A set with no edges does nothing. |
| `mode23` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 23's sizes: equal distance, two distances, or distance and angle. |
| `distance23` | `string \| number \| ParameterHandle` | optional | Set 23's first distance, along the face that takes it; a length. |
| `distanceB23` | `string \| number \| ParameterHandle` | optional | Set 23's second distance, with two-distances; a length. |
| `angle23` | `string \| number \| ParameterHandle` | optional | Set 23's angle to the first distance, with distance-angle; an angle. |
| `flip23` | `boolean` | default `false` | Set 23's first distance goes on the other face. |
| `face23` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges24` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 24's edges to chamfer. A set with no edges does nothing. |
| `mode24` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 24's sizes: equal distance, two distances, or distance and angle. |
| `distance24` | `string \| number \| ParameterHandle` | optional | Set 24's first distance, along the face that takes it; a length. |
| `distanceB24` | `string \| number \| ParameterHandle` | optional | Set 24's second distance, with two-distances; a length. |
| `angle24` | `string \| number \| ParameterHandle` | optional | Set 24's angle to the first distance, with distance-angle; an angle. |
| `flip24` | `boolean` | default `false` | Set 24's first distance goes on the other face. |
| `face24` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges25` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 25's edges to chamfer. A set with no edges does nothing. |
| `mode25` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 25's sizes: equal distance, two distances, or distance and angle. |
| `distance25` | `string \| number \| ParameterHandle` | optional | Set 25's first distance, along the face that takes it; a length. |
| `distanceB25` | `string \| number \| ParameterHandle` | optional | Set 25's second distance, with two-distances; a length. |
| `angle25` | `string \| number \| ParameterHandle` | optional | Set 25's angle to the first distance, with distance-angle; an angle. |
| `flip25` | `boolean` | default `false` | Set 25's first distance goes on the other face. |
| `face25` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges26` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 26's edges to chamfer. A set with no edges does nothing. |
| `mode26` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 26's sizes: equal distance, two distances, or distance and angle. |
| `distance26` | `string \| number \| ParameterHandle` | optional | Set 26's first distance, along the face that takes it; a length. |
| `distanceB26` | `string \| number \| ParameterHandle` | optional | Set 26's second distance, with two-distances; a length. |
| `angle26` | `string \| number \| ParameterHandle` | optional | Set 26's angle to the first distance, with distance-angle; an angle. |
| `flip26` | `boolean` | default `false` | Set 26's first distance goes on the other face. |
| `face26` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges27` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 27's edges to chamfer. A set with no edges does nothing. |
| `mode27` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 27's sizes: equal distance, two distances, or distance and angle. |
| `distance27` | `string \| number \| ParameterHandle` | optional | Set 27's first distance, along the face that takes it; a length. |
| `distanceB27` | `string \| number \| ParameterHandle` | optional | Set 27's second distance, with two-distances; a length. |
| `angle27` | `string \| number \| ParameterHandle` | optional | Set 27's angle to the first distance, with distance-angle; an angle. |
| `flip27` | `boolean` | default `false` | Set 27's first distance goes on the other face. |
| `face27` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges28` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 28's edges to chamfer. A set with no edges does nothing. |
| `mode28` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 28's sizes: equal distance, two distances, or distance and angle. |
| `distance28` | `string \| number \| ParameterHandle` | optional | Set 28's first distance, along the face that takes it; a length. |
| `distanceB28` | `string \| number \| ParameterHandle` | optional | Set 28's second distance, with two-distances; a length. |
| `angle28` | `string \| number \| ParameterHandle` | optional | Set 28's angle to the first distance, with distance-angle; an angle. |
| `flip28` | `boolean` | default `false` | Set 28's first distance goes on the other face. |
| `face28` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges29` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 29's edges to chamfer. A set with no edges does nothing. |
| `mode29` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 29's sizes: equal distance, two distances, or distance and angle. |
| `distance29` | `string \| number \| ParameterHandle` | optional | Set 29's first distance, along the face that takes it; a length. |
| `distanceB29` | `string \| number \| ParameterHandle` | optional | Set 29's second distance, with two-distances; a length. |
| `angle29` | `string \| number \| ParameterHandle` | optional | Set 29's angle to the first distance, with distance-angle; an angle. |
| `flip29` | `boolean` | default `false` | Set 29's first distance goes on the other face. |
| `face29` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges30` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 30's edges to chamfer. A set with no edges does nothing. |
| `mode30` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 30's sizes: equal distance, two distances, or distance and angle. |
| `distance30` | `string \| number \| ParameterHandle` | optional | Set 30's first distance, along the face that takes it; a length. |
| `distanceB30` | `string \| number \| ParameterHandle` | optional | Set 30's second distance, with two-distances; a length. |
| `angle30` | `string \| number \| ParameterHandle` | optional | Set 30's angle to the first distance, with distance-angle; an angle. |
| `flip30` | `boolean` | default `false` | Set 30's first distance goes on the other face. |
| `face30` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges31` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 31's edges to chamfer. A set with no edges does nothing. |
| `mode31` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 31's sizes: equal distance, two distances, or distance and angle. |
| `distance31` | `string \| number \| ParameterHandle` | optional | Set 31's first distance, along the face that takes it; a length. |
| `distanceB31` | `string \| number \| ParameterHandle` | optional | Set 31's second distance, with two-distances; a length. |
| `angle31` | `string \| number \| ParameterHandle` | optional | Set 31's angle to the first distance, with distance-angle; an angle. |
| `flip31` | `boolean` | default `false` | Set 31's first distance goes on the other face. |
| `face31` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |
| `edges32` | `GeomRef \| GeomRef[]` (`edge`) | optional | Set 32's edges to chamfer. A set with no edges does nothing. |
| `mode32` | `'equal' \| 'two-distances' \| 'distance-angle'` | default `equal` | Set 32's sizes: equal distance, two distances, or distance and angle. |
| `distance32` | `string \| number \| ParameterHandle` | optional | Set 32's first distance, along the face that takes it; a length. |
| `distanceB32` | `string \| number \| ParameterHandle` | optional | Set 32's second distance, with two-distances; a length. |
| `angle32` | `string \| number \| ParameterHandle` | optional | Set 32's angle to the first distance, with distance-angle; an angle. |
| `flip32` | `boolean` | default `false` | Set 32's first distance goes on the other face. |
| `face32` | `GeomRef \| GeomRef[]` (`face`) | optional | The face the chamfer's distances are measured from, for this set's edges. |

## Faces

| Role | What it is |
| --- | --- |
| `from:(<edge>)` | The bevel: a face the chamfer makes from each edge it bevels. |

`handle.face(role)` builds a reference to one of them and `handle.faceName(role)` its
persistent name.
A `<…>` is what varies: a `side:<sketch curve>` is the wall of the curve you pass,
and a role of a face that no face carries takes that part out.
A role this feature never names is a lost reference — a visible error, never a silent
guess.

## Example

```ts
import { Design, type LineHandle } from '@extrudo/api';

const d = Design.create({ name: 'My part' });

// Two solids to point faces, edges and bodies at.
const plate = d.box({ length: '40 mm', width: '20 mm', height: '10 mm' });
const shaft = d.cylinder({ diameter: '20 mm', height: '20 mm' });

// A sketch with two closed profiles, a hole and a guide line beside them.
let guide!: LineHandle;
const s = d.sketch(d.origin.xy, (k) => {
  k.rectangle([0, 0], [40, 20]);
  k.circle([10, 10], '3 mm');
  k.rectangle([50, 0], [60, 10]);
  guide = k.line([-5, 30], [45, 30]);
});

const profile = s.profileAt([1, 1]);
const sections = s.profiles();
const line = guide.ref();
const face = plate.face('side:front');
const edge = plate.edge([plate.faceName('side:front'), plate.faceName('side:right')]);
const vertex = plate.vertex([plate.faceName('side:front'), plate.faceName('side:right')]);
const corner = plate.vertex([plate.faceName('side:front'), plate.faceName('side:left')]);
const body = plate.body();
const step = 'att-part.step'; // an attachment of the design
const plan = 'att-plan.png';

// Chamfer.
d.chamfer({ edges: edge, distance: '1 mm' });
```

## See also

- [Features by category](README.md)
- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder
- [References](../references.md) — every helper that builds a reference