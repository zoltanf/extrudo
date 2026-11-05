---
title: Emboss
section: Tools
category: Solid
order: 28
---

# Emboss

Raise the letters of a sketch, or a whole text, off a face, or press them into it; round a cylinder or a cone they keep their width.

| Where | Shortcut |
|---|---|
| Solid › Features | None |

<video src="demo:emboss" muted loop autoplay playsinline aria-label="Emboss demo"></video>

<!-- notes -->
## Step by step

1. Sketch the letters or shapes beside the model (a **Text** in a sketch is
   the usual case), on a plane clear of the body so you can click them.
2. Choose **Emboss** in **Solid › Features**. Pick the profiles, or click a
   letter to take the whole text, then click the face (or faces) to put them
   on.
3. Set **Depth**, and choose **Emboss** to raise the letters or **Deboss** to
   press them in.
4. The **Method** line says how each face takes the letters: moved onto a
   flat face, wrapped round a cylinder or a cone, or projected onto any other
   curved face. The preview shows the result; **OK** makes it.

On a flat face the sketch must be parallel to it. Round a cylinder it must be
parallel to the cylinder's axis, and the letters keep their width. Round a
cone it may also lie parallel to one of the cone's tangent planes.

## Several faces

- **Faces** takes more than one face, all of one body. Click a picked face
  again to take it out.
- Each face takes the part of the letters that lies in front of it, and the
  letters stop at the edges of the picked faces.
- A flat face beside a fillet, or the pieces of one cylinder, line up where
  they meet.
- A letter across a sharp edge between a wrapped face and a flat one (the
  flat of a D-shaped shaft) jogs there. An emboss across a convex crease
  between two projected faces has a small V-notch where the two parts meet.

## Tangent to the face

Turn on **Tangent to the face** and the letters land as if you had made a
Tangent Plane at the point straight in front of them and sketched them there.

- A sketch at any angle works, not only one parallel to the face.
- Letters under a face read the right way round seen from outside.
- A text off a sphere's centre stays undistorted.
- The depth arrow stands where the letters were laid.

The profiles must share one plane, and the line through their centre along the
sketch's normal must meet a picked face.

## Messages

- "Pick at least one profile or text to emboss.": nothing is picked in
  **Profiles**. Click the sketch's profiles or a letter of the text.
- "Pick the face to emboss on.": no face is picked. Click one.
- "Pick faces of one body to emboss on.": the faces belong to different
  bodies. Keep the faces of one.
- "The depth must be greater than 0.": give a depth above zero.
- "Sketch on a plane parallel to the face to emboss on a flat face.": the
  sketch isn't parallel to the flat face. Move the sketch, or turn on
  **Tangent to the face**.
- "Sketch on a plane parallel to the cylinder's axis to emboss on a round
  face.": the sketch faces the cylinder's end. Sketch on a plane along its
  axis, or turn on **Tangent to the face**.
- "Sketch on a plane parallel to the cone's axis, or to one of its tangent
  planes, to emboss on a round face.": the same for a cone. A Tangent Plane
  on the cone, and a sketch on a plane parallel to it, also works.
- "Put the profiles in one plane to emboss them on a curved face.": the
  profiles come from different planes. Sketch them in one.
- "Put the profiles in one plane to emboss them tangent to the face.": the
  same with **Tangent to the face** on.
- "The profiles don't touch the face." / "The profiles don't touch the
  faces.": no letter lands on the picked face or faces. Pick the face the
  letters are in front of, or move the sketch.
- "No letters land on face *k*.": a warning with several faces: face *k* of the
  list takes none of the letters. Take it out of **Faces** or move the
  sketch.
- "Tangent to the face needs the face in front of the profiles: the line
  through their centre along the sketch's normal misses it.": the sketch isn't
  in front of any picked face. Move it so its centre looks at a face.
<!-- /notes -->
