# Free meshes (triangle-mesh deformers)

Status: built 2026-11-07 (all six steps). A second deformer kind next to the lattice in [mesh-warp.md](mesh-warp.md): a part is drawn
on a triangle mesh of any shape, and every vertex can carry its own keyforms (what Live2D calls an art mesh). The lattice
deformer stays as it is.

## Decisions

- **Per-vertex keyforms** (the mesh vertices are the control points). A mesh that only follows a lattice is not planned.
- **Kinds side by side.** A deformer has `grid` (lattice) or `mesh` (free), not both. Group warps, masks and the studio
  work with either, through the same few lookups (see Core).
- **Cap of 500 vertices** per mesh, a fixed limit enforced by `checkRig` and by the generator.
- **The mesh may reach past the opaque area, but not past the image box.** The generator adds a margin around the alpha
  outline, so vertices that move outward do not clip the art; the margin is cut at the image edge, because UVs outside
  the texture would repeat its border row and column (clamp-to-edge) and smear the art, as eyes touching their box showed. Triangles that end up wholly transparent are kept (they cost little).
- **Topology edits drop keyforms, after a confirmation.** Adding, deleting or regenerating vertices and changing edges
  throw away the deformer's per-vertex keyform points, behind a confirm dialog that says so. Dragging vertices in the keyform
  editor is not a topology edit and is never gated. With no keyforms yet, there is no prompt. The drop is one undo step.
- **Generation is automatic first, manual second.** A detail setting makes the first mesh; the manual tools fix it.

## Model

```json
{ "id": "cloak_mesh", "part": "cloak",
  "mesh": { "verts": [x0, y0, x1, y1, ...], "tris": [i, j, k, ...] },
  "keyforms": [ ... same shapes as a lattice ... ] }
```

- `verts` are rest positions in the part's own pixels (the image box at the origin, as for lattice meshes). They are stored,
  because they are not a regular grid. `tris` are index triples, wound consistently.
- Keyforms use the existing `params.ts` shapes. `pts` is sparse and indexes vertices instead of lattice points; the unit is
  the animation `Offset` (stage fractions), as for the lattice.
- The renderer builds a Pixi `Mesh` with a `MeshGeometry` (positions, UVs from the rest positions over the image box,
  indices) in place of the `MeshPlane`. The dirty key, buffer upload and per-part container are the same.
- `checkDeformers`: at most 500 vertices; indices in range; at least one triangle; no degenerate (zero-area) triangles; no
  vertex outside the part's box plus a margin; one deformer per part; `pts` indices in range; the frame-track conflict as
  for the lattice.

## Core (pure, `engine/src`)

The lattice code assumes a grid in a few places; each gets a mesh counterpart behind one interface:

| Today (grid) | Free mesh |
|---|---|
| `restLattice` | the stored `verts` |
| `unwarpPoint` (click-to-pick) | find the triangle containing the point (barycentric), map back to rest |
| `sampleLattice` (group warps) | barycentric sample of the vertex displacement at a rest position |
| `latticeEdges` (overlay) | unique triangle edges |
| `softWeights` (distance in cells) | graph distance along edges, or Euclidean distance as the option |
| smooth / mirror | Laplacian smoothing over the edge graph; mirror matches vertices across an axis by nearest rest position |
| grid resize | not applicable; replaced by remesh / detail |

New pure modules (with tests in `engine/test/`):

- `mesh-gen.ts`: alpha outline (marching squares on an alpha mask), simplified by tolerance; outline grown by the margin;
  interior points on a jittered or hex grid at the detail spacing; constrained Delaunay triangulation; clamped to the cap
  (coarsens until it fits). Input is an alpha array, so it runs in node; the browser supplies pixels from the part image.
- `mesh-edit.ts`: add vertex (split the containing triangle or edge), delete vertex (re-triangulate the hole), move vertex,
  flip edge, add / remove edge (constrained), and `dropMeshKeyforms`. All return a new mesh and never leave a degenerate or
  overlapping triangle (an edit that would is refused).
- `mesh.ts`: barycentric lookup, adjacency, edges, the lookups above.

### Detail setting

One control with named steps (for example Low / Medium / High / Very high) that map to outline tolerance and interior spacing
in pixels, plus the margin. It is stored with the mesh only as a hint (`mesh.detail`), so Regenerate starts from it; the
mesh itself is the data.

## Studio

A **Mesh** section and tool beside Warp (Model mode), reusing the Warp overlay, selection and soft-reach machinery:

- **Generate** with the detail control and a preview of the vertex count; Regenerate is a topology edit (confirm if keyforms exist).
- **Vertex editing** (keyform mode, never gated): drag a vertex into the parameter's keyform exactly as a lattice point;
  select, rectangle, Shift-click, soft reach, reset, mirror and smooth on the selection.
- **Topology mode** (confirm if keyforms exist): add vertex by click, delete, move rest position, flip edge, add / remove edge.
  Leaving the mode returns to keyform mode.
- The overlay draws triangle edges, with constant on-screen handles as for the lattice.

**Built (step 5, topology):** the Mesh section has an **Edit topology** switch (leaving it, or Esc with no Add edge under way, returns to keyform
mode; the keyform controls are away meanwhile). Its tools: **Add vertex** (click inside a triangle to split it in three; within a few pixels of an
edge it splits that edge and the triangle on its other side, the vertex lying on the edge; a ghost point shows where), **Delete vertex** (the
neighbours' polygon is re-triangulated by ear clipping; an outline vertex closes its fan with a chord), **Move vertex** (drag the *rest* position),
**Flip edge** (only between two triangles, only when the quad is convex), **Add edge** (click two vertices that share a neighbour: the edge closes a
new triangle across the outline, refused when it would overlap the mesh) and **Remove edge** (an outline edge only: it takes its triangle away; an
inner edge would leave a hole, and the last triangle or a vertex left with no triangle is refused). Add edge and Remove edge are inverses; "add an
edge between any two vertices" has no meaning in a triangle mesh (an edge always belongs to a triangle), so a constrained insertion that retriangulates
across existing edges was left out. Every edit is the pure functions `addMeshVertex`, `deleteMeshVertex`, `moveMeshVertex`, `flipMeshEdge`,
`addMeshEdge`, `removeMeshEdge` in `engine/src/mesh-edit.ts`: they return a new `{ verts, tris }` or `{ error }` (the panel shows the message), and
`meshProblem` (also exported) guards each result: indices in range, no flat or flipped triangle, one winding (no directed edge used twice), no unused
vertex, no overlapping triangles, at most 500 vertices. The tests include random sequences of all six edits that check the mesh after every step.
Vertex numbers move (a new vertex is last; a deleted one shifts the rest down), so `setMeshGeometry` drops the deformer's keyforms: with keyforms
present a confirm dialog says so and the edit and the drop are one undo step (undo brings the keyforms back); with none there is no prompt. A Move drag
shows the vertex moving with the keyforms still in place and asks on release. Keyform mode never asks. The stage gets `topo` and `anchor` in
`studioWarp` and answers with `studioMeshTopo { id, op, vertex | a, b | at }` (a Move is a `studioWarpDrag`); `studioDeformerRestPoint` turns a stage
pixel into the rest position.

**Built (step 4, vertex editing):** on a mesh the Warp tool's vertices are live handles, exactly as lattice points are: press one to drag it (and
the chosen ones) into the active parameter's keyform, with the same key snapping, key insertion and one undo step per drag (`setWarpOwn`; `pts` is
indexed by vertex). Click, Shift-click, a rectangle, Ctrl+A / Esc, the All / None / Invert buttons and the vertex list choose vertices. **Soft** reach
fades over hops along the mesh's edges (`meshSoftWeights` / `softWeights` on a mesh deformer; the *reach* field counts edges), with the linear /
smooth / constant curves; a vertex with no edge path to the selection (another island) is never pulled. Scale and rotate work about the selection or
the part centre (`transformMeshPoints`), Reset sets chosen vertices to rest in the keyform, the vertex fields type an exact displacement, Smooth is a
Laplacian step over the edges (`smoothMeshWarp`), and Mirror matches vertices across the part's vertical middle by nearest rest position within 3% of the
part's size (`mirrorMeshWarp`; vertices with no partner are left alone and counted in the note). The sway / breathe / sine / noise presets write one
displacement per vertex from its place in the image box (`warpPreset` with `pixels`). The grid-size, row and column controls stay lattice-only.

**Built (step 3, read-only):** the **Mesh** row sits at the top of the Warp section (Model mode, any chosen part): a **Detail** choice
(Low / Medium / High / Very high), an optional **margin** in image pixels (empty: the generator's own), a live vertex count (cap 500) and
**Generate mesh**. The stage hands the editor the part image's alpha (`studioAlpha` / `studioAlphaData`, drawn to a canvas and read),
`generateMesh` runs in the editor, and `setPartMesh` (`engine/src/mesh-edit.ts`) writes `deformers[].mesh = { verts, tris, detail }`. A part has
one deformer: with a lattice the button reads *Replace lattice with mesh* and asks first (its keyforms go); with a mesh it reads *Regenerate
mesh*, which asks only when the mesh has keyforms and drops them in the same single undo step. The Warp tool draws the mesh (`studioDeformerMesh`:
triangle edges, a 3 px dot per vertex; inert in step 3, handles since step 4). For a mesh the section shows a summary (vertices, triangles, detail)
and Remove warp in place of the grid size, and hides the row and column pickers. Test: `animation studio: the Mesh row generates...` in `browser.test.mjs`; the pure helpers are in `mesh-edit.test.mjs`.
- Presets (sway, breathe, sine, noise) keep working on a mesh through the same per-vertex writes.

## Implementation order

1. **Done:** Data model: `RigData` types, `checkDeformers` rules, `mesh.ts` lookups, tests. A hand-written mesh in a test rig.
2. **Done:** Renderer: `Mesh` + `MeshGeometry` for a mesh deformer, dirty key, group-warp members and masks that follow a part (the
   barycentric lookups), click-to-pick.
3. **Done:** `mesh-gen.ts` with the detail steps and cap, tests; a read-only overlay and Generate button.
4. **Done:** Keyform editing of vertices: reuse the Warp tool's drag, selection and presets over the mesh interface.
5. **Done:** `mesh-edit.ts` and the topology tools with the confirm-and-drop gate and one-undo-step drop.
6. **Done:** Docs (`rig-json.md`, `commands.md` unaffected), browser tests (generate, drag a vertex, topology edit with confirm).

Estimate: about 2 to 2.5 weeks; steps 1-3 (about a week) already give hand-written or generated meshes in the game.

## Risks

- Alpha outline quality on thin or detailed art (hair strands): tolerance and margin need tuning; keep a manual path.
- Constrained Delaunay is the one non-trivial algorithm; write it small and test it against random point sets for
  validity (no overlaps, all points used).
- Keyform editing after a topology edit is lossy by design; the confirm and the single undo step are the safeguard.
- Overdraw of transparent triangles on low-end phones: the cap of 500 vertices bounds it.
