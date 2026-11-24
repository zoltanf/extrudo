/**
 * Test support (no production code): small Part-workbench documents made for the
 * primitives-and-booleans slice (ADR-0144 S11): boxes, cylinders, spheres and toruses
 * placed and turned, cuts, fuses and commons (and their several-operand forms) with and
 * without placements of their own, shared operands, stored leaves, a PartDesign body as an
 * operand, compounds, containers, refine, a split result, Part fillets and chamfers, mirrors,
 * spreadsheet-bound sizes and a chain of twelve cuts. The documents are ours: built with
 * FreeCAD 1.1.4 by the script beside this package
 * (`packages/fcstd/scripts/make-part-fixtures.py`; its JSON made this module by
 * `part-fixtures-to-module.py` beside it), so each object's XML, each stored shape, each
 * placement and the `EdgeN` numbering are FreeCAD's own. Each object is its own `<Object>`
 * element with the properties the importer never reads left out, white space between
 * elements dropped, trailing zeros cut and FreeCAD's repeated markup written as the tokens
 * of `FINAL_TOKENS` (`part-parts.ts` expands them); `hidden` where FreeCAD hides it, FreeCAD's
 * measures of its stored shape (`measure`: box as min then max), a Part fillet's or
 * chamfer's binary edge list (`files`, base64) and its edges (`edges`: index, first and
 * second size). Each distinct B-rep text is stored once, each run of spaces made one, the
 * texts joined by NUL and deflated (`FINAL_BREP_DEFLATED`, base64): plain, they are 586 KB.
 */
/* biome-ignore-all lint: generated data */

export interface PartFixtureObject {
  readonly object: string;
  readonly type: string;
  readonly label: string;
  readonly xml: string;
  readonly hidden?: true;
  readonly stored?: number;
  readonly measure?: {
    readonly solids: number;
    readonly volume: number;
    readonly area: number;
    readonly box: readonly number[];
    readonly centre: readonly number[];
  };
  readonly files?: Readonly<Record<string, string>>;
  readonly edges?: readonly (readonly [number, number, number])[];
}

export interface PartFixtureCase {
  readonly note: string;
  readonly roots: readonly string[];
  readonly objects: readonly PartFixtureObject[];
}

export const FINAL_TOKENS: readonly (readonly [string, string])[] = [
  ['§a', '<Property name="'],
  ['§b', '</Property>'],
  ['§c', ' type="App::PropertyPlacement"><PropertyPlacement Px="'],
  ['§d', '" Q0="0" Q1="0" Q2="0" Q3="1" A="0" Ox="0" Oy="0" Oz="1"/>'],
  ['§e', ' type="App::PropertyLength"><Float value="'],
  ['§f', ' type="App::PropertyLink"><Link value="'],
  ['§g', ' type="App::PropertyString"'],
  ['§h', ' type="Part::PropertyPartShape"><Part ElementMap="15.70200.5" file="'],
  [
    '§i',
    '§aExpressionEngine" type="App::PropertyExpressionEngine"><ExpressionEngine count="0"></ExpressionEngine>§b',
  ],
  [
    '§l',
    '<Extensions Count="1"><Extension type="Part::AttachExtension" name="AttachExtension"></Extension></Extensions>',
  ],
  ['§m', '<Extension type="Part::AttachExtension" name="AttachExtension"></Extension>'],
  ['§j', ' type="App::PropertyAngle"><Float value="'],
  ['§k', ' type="App::PropertyBool"><Bool value="'],
];

export const FINAL_BREP_DEFLATED =
  '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';

export const FINAL_CASES: Readonly<Record<string, PartFixtureCase>> = {
  extrusion_forward: {
    note: 'a sketch extruded 12 mm along its normal',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 0,
        measure: {
          solids: 1,
          volume: 7200.0,
          area: 2400.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 12.0],
          centre: [15.0, 10.0, 6.0],
        },
      },
    ],
  },
  extrusion_both: {
    note: 'a sketch extruded 12 mm forward and 5 back',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="5"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 1,
        measure: {
          solids: 1,
          volume: 10200.0,
          area: 2900.0,
          box: [0.0, 0.0, -5.0, 30.0, 20.0, 12.0],
          centre: [15.0, 10.0, 3.5000000000000004],
        },
      },
    ],
  },
  extrusion_symmetric: {
    note: 'a sketch extruded 12 mm in all, symmetric',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§ktrue"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 2,
        measure: {
          solids: 1,
          volume: 7200.0,
          area: 2400.0,
          box: [0.0, 0.0, -6.0, 30.0, 20.0, 6.0],
          centre: [15.0, 10.0, 0.0],
        },
      },
    ],
  },
  extrusion_reversed: {
    note: 'a sketch extruded 12 mm, reversed',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§ktrue"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 3,
        measure: {
          solids: 1,
          volume: 7200.0,
          area: 2400.0,
          box: [0.0, 0.0, -12.0, 30.0, 20.0, 0.0],
          centre: [15.0, 10.0, -6.0],
        },
      },
    ],
  },
  extrusion_tapered: {
    note: 'a sketch extruded 12 mm with a 5 degree taper',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j5"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 4,
        measure: {
          solids: 1,
          volume: 7847.553806816406,
          area: 2564.565023700871,
          box: [
            -1.0498639623110897, -1.0498639623110897, 0.0, 31.04986396231109, 21.04986396231109,
            12.0,
          ],
          centre: [14.999999999999998, 9.999999999999996, 6.167280540583527],
        },
      },
    ],
  },
  extrusion_custom: {
    note: 'a sketch extruded along a custom direction',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="1" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 5,
        measure: {
          solids: 1,
          volume: 5091.168824543141,
          area: 2259.411254969543,
          box: [0.0, 0.0, 0.0, 30.0, 28.485281374238568, 8.48528137423857],
          centre: [14.999999999999998, 14.24264068711928, 4.242640687119283],
        },
      },
    ],
  },
  extrusion_of_face: {
    note: 'a face of a box extruded',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Plane',
        type: 'Part::Plane',
        label: 'Plane',
        xml: '<Object name="Plane" Extensions="True">§l<Properties Count="16" TransientCount="1">§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEngine3D"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§i§aLabel"§g><String value="Plane"/>§b§aLength"§e30"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hPlane.Shape.brp"/>§b§aWidth"§e20"/>§b</Properties></Object>',
        measure: {
          solids: 0,
          volume: 0.0,
          area: 600.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fPlane"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="5"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 6,
        measure: {
          solids: 1,
          volume: 3000.0,
          area: 1700.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 5.0],
          centre: [15.0, 10.0, 2.5],
        },
      },
    ],
  },
  extrusion_placed: {
    note: 'a sketch moved and tilted, extruded',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c10" Py="5" Pz="7" Q0="0.2588190451025207" Q1="0" Q2="0" Q3="0.9659258262890683" A="0.5235987755982988" Ox="1" Oy="0" Oz="0"/>§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [10.0, 5.0, 7.0, 40.0, 22.320508075688775, 17.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="-0.4999999999999999" valueZ="0.8660254037844388"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 7,
        measure: {
          solids: 1,
          volume: 7200.0,
          area: 2400.0,
          box: [10.0, -0.9999999999999991, 7.0, 40.0, 22.320508075688775, 27.392304845413268],
          centre: [25.000000000000004, 10.66025403784439, 17.196152422706632],
        },
      },
    ],
  },
  extrusion_in_part: {
    note: 'a sketch and its extrusion in a moved and turned part',
    roots: ['Part'],
    objects: [
      {
        object: 'Part',
        type: 'App::Part',
        label: 'Part',
        xml: '<Object name="Part" Extensions="True"><Extensions Count="1"><Extension type="App::OriginGroupExtension" name="OriginGroupExtension"></Extension></Extensions><Properties Count="15" TransientCount="2">§aColor" type="App::PropertyColor"><PropertyColor value="4294967040"/>§b§i§aGroup" type="App::PropertyLinkList"><LinkList count="2"><Link value="Extrude"/><Link value="Sketch"/></LinkList>§b§aId"§g><String value=""/>§b§aLabel"§g><String value="Part"/>§b§aLicense"§g><String value=""/>§b§aLicenseURL"§g><String value=""/>§b§aMaterial"§f"/>§b§aMeta" type="App::PropertyMap"><Map count="0"></Map>§b§aOrigin"§fOrigin"/>§b§aPlacement"§c100" Py="0" Pz="0" Q0="0" Q1="0" Q2="0.7071067811865475" Q3="0.7071067811865476" A="1.5707963267948966" Ox="0" Oy="0" Oz="1"/>§b§aType"§g><String value=""/>§b§aUid" type="App::PropertyUUID"><Uuid value="e5220f63-dbad-47b8-aa2c-72f37f003a25"/>§b</Properties></Object>',
        stored: 8,
        measure: {
          solids: 1,
          volume: 7200.0,
          area: 2400.0,
          box: [80.0, 0.0, 0.0, 100.0, 30.000000000000004, 12.0],
          centre: [90.0, 15.000000000000002, 6.0],
        },
      },
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 9,
        measure: {
          solids: 1,
          volume: 7200.0,
          area: 2400.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 12.0],
          centre: [15.0, 10.0, 6.0],
        },
      },
    ],
  },
  extrusion_under_cut: {
    note: 'a sketch with a hole extruded both ways, under a cut',
    roots: ['Cut'],
    objects: [
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="5"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomCircle" id="5" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="5" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><Circle CenterX="15" CenterY="10" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="4"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Sketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§i§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="3"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        hidden: true,
        stored: 10,
        measure: {
          solids: 1,
          volume: 8246.017763138449,
          area: 2976.460153515902,
          box: [0.0, 0.0, -3.0, 30.0, 20.0, 12.0],
          centre: [15.000000000000002, 10.0, 4.500000000000001],
        },
      },
      {
        object: 'Cylinder',
        type: 'Part::Cylinder',
        label: 'Cylinder',
        xml: '<Object name="Cylinder" Extensions="True"><Extensions Count="2">§m<Extension type="Part::PrismExtension" name="PrismExtension"></Extension></Extensions><Properties Count="19" TransientCount="1">§aAngle"§j360"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEngine3D"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§i§aFirstAngle"§j0"/>§b§aHeight"§e30"/>§b§aLabel"§g><String value="Cylinder"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c5" Py="5" Pz="-5§d§b§aRadius"§e3"/>§b§aSecondAngle"§j0"/>§b§aShape"§hCylinder.Shape.brp"/>§b</Properties></Object>',
        hidden: true,
        stored: 11,
        measure: {
          solids: 1,
          volume: 848.2300164692441,
          area: 622.0353454107791,
          box: [2.0, 2.0, -5.0, 8.0, 8.0, 25.0],
          centre: [5.0, 5.0, 10.000000000000002],
        },
      },
      {
        object: 'Cut',
        type: 'Part::Cut',
        label: 'Cut',
        xml: '<Object name="Cut"><Properties Count="10" TransientCount="2">§aBase"§fExtrude"/>§b§i§aLabel"§g><String value="Cut"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aRefine"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Cut.Shape.brp"/>§b§aTool"§fCylinder"/>§b</Properties></Object>',
        stored: 12,
        measure: {
          solids: 1,
          volume: 7821.902754903827,
          area: 3202.654824574367,
          box: [0.0, 0.0, -3.0, 30.0, 20.0, 12.0],
          centre: [15.54221462670158, 10.271107313350788, 4.500000000000002],
        },
      },
    ],
  },
  extrusion_bound: {
    note: 'an extrusion whose length reads a spreadsheet alias',
    roots: ['Extrude'],
    objects: [
      {
        object: 'Sheet',
        type: 'Spreadsheet::Sheet',
        label: 'Sheet',
        xml: '<Object name="Sheet"><Properties Count="7" TransientCount="0">§i§aLabel"§g><String value="Sheet"/>§b§acells" type="Spreadsheet::PropertySheet"><Cells Count="1" xlink="1"><XLinks count="0"></XLinks><Cell address="A1" content="12" alias="height" /></Cells>§b</Properties></Object>',
      },
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="30" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="0" StartZ="0" EndX="30" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="30" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="0"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        hidden: true,
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Extrude',
        type: 'Part::Extrusion',
        label: 'Extrude',
        xml: '<Object name="Extrude"><Properties Count="21" TransientCount="1">§aBase"§fSketch"/>§b§aDir" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§aDirLink" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aDirMode" type="App::PropertyEnumeration"><Integer value="2"/>§b§aExpressionEngine" type="App::PropertyExpressionEngine"><ExpressionEngine count="1"><Expression path="LengthFwd" expression="Sheet.height"/></ExpressionEngine>§b§aFaceMakerClass"§g><String value="Part::FaceMakerBullseye"/>§b§aFaceMakerMode" type="App::PropertyEnumeration"><Integer value="3" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Simple"/><Enum value="Cheese"/><Enum value="Extrusion"/><Enum value="Bullseye"/></CustomEnumList>§b§aInnerWireTaper" type="App::PropertyEnumeration"><Integer value="0"/>§b§aLabel"§g><String value="Extrude"/>§b§aLengthFwd" type="App::PropertyDistance"><Float value="12"/>§b§aLengthRev" type="App::PropertyDistance"><Float value="0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Extrude.Shape.brp"/>§b§aSolid"§ktrue"/>§b§aSymmetric"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngleRev"§j0"/>§b</Properties></Object>',
        stored: 0,
        measure: {
          solids: 1,
          volume: 7200.0,
          area: 2400.0,
          box: [0.0, 0.0, 0.0, 30.0, 20.0, 12.0],
          centre: [15.0, 10.0, 6.0],
        },
      },
    ],
  },
  body_on_face: {
    note: "a body whose pocket's sketch is attached to its pad's top face",
    roots: ['Body'],
    objects: [
      {
        object: 'Body',
        type: 'PartDesign::Body',
        label: 'Body',
        xml: '<Object name="Body" Extensions="True"><Extensions Count="1"><Extension type="App::OriginGroupExtension" name="OriginGroupExtension"></Extension></Extensions><Properties Count="12" TransientCount="2">§aAllowCompound"§ktrue"/>§b§aBaseFeature"§f"/>§b§i§aGroup" type="App::PropertyLinkList"><LinkList count="4"><Link value="Sketch"/><Link value="Pad"/><Link value="PocketSketch"/><Link value="Pocket"/></LinkList>§b§aLabel"§g><String value="Body"/>§b§aOrigin"§fOrigin"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Body.Shape.brp"/>§b§aTip"§fPocket"/>§b</Properties></Object>',
        stored: 13,
        measure: {
          solids: 1,
          volume: 7748.672587712816,
          area: 2925.6637061435913,
          box: [0.0, 0.0, 0.0, 40.0, 20.0, 10.0],
          centre: [20.324348989381377, 10.000000000000004, 4.9189127526546566],
        },
      },
      {
        object: 'Sketch',
        type: 'Sketcher::SketchObject',
        label: 'Sketch',
        xml: '<Object name="Sketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="1"><Link obj="XY_Plane" sub=""/></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="4"><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="0" FirstPos="2" Second="1" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="0 1 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="1" FirstPos="2" Second="2" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="1 2 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="2" FirstPos="2" Second="3" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="2 3 -2000" ElementPositions="2 1 0" /><Constrain Name="" Type="1" Value="0" LabelDistance="10" LabelPosition="0" IsDriving="1" IsInVirtualSpace="0" IsVisible="1" IsActive="1" First="3" FirstPos="2" Second="0" SecondPos="1" Third="-2000" ThirdPos="0" ElementIds="3 0 -2000" ElementPositions="2 1 0" /></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="4"><Geometry type="Part::GeomLineSegment" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="40" EndY="0" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="2" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="40" StartY="0" StartZ="0" EndX="40" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="3" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="3" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="40" StartY="20" StartZ="0" EndX="0" EndY="20" EndZ="0"/><Construction value="0"/></Geometry><Geometry type="Part::GeomLineSegment" id="4" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="4" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><LineSegment StartX="0" StartY="20" StartZ="0" EndX="0" EndY="0" EndZ="0"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="Sketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="5"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aShape"§hSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [0.0, 0.0, 0.0, 40.0, 20.0, 0.0],
          centre: null,
        },
      },
      {
        object: 'Pad',
        type: 'PartDesign::Pad',
        label: 'Pad',
        xml: '<Object name="Pad" Extensions="True"><Extensions Count="2"><Extension type="App::SuppressibleExtension" name="SuppressibleExtension"></Extension><Extension type="Part::PreviewExtension" name="PreviewExtension"></Extension></Extensions><Properties Count="34" TransientCount="3">§aAllowMultiFace"§ktrue"/>§b§aAlongSketchNormal"§ktrue"/>§b§aBaseFeature"§f"/>§b§aDirection" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="1"/>§b§i§aFuzzyTolerance" type="App::PropertyFloatConstraint"><Float value="-1"/>§b§aLabel"§g><String value="Pad"/>§b§aLength"§e10"/>§b§aLength2"§e10"/>§b§aMidplane"§kfalse"/>§b§aOffset"§e0"/>§b§aOffset2"§e0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aProfile" type="App::PropertyLinkSub"><LinkSub value="Sketch" count="0"></LinkSub>§b§aReferenceAxis" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aRefine"§ktrue"/>§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Pad.Shape.brp"/>§b§aSideType" type="App::PropertyEnumeration"><Integer value="0"/>§b§aSuppressed"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngle2"§j0"/>§b§aType" type="App::PropertyEnumeration"><Integer value="0"/>§b§aType2" type="App::PropertyEnumeration"><Integer value="0"/>§b§aUpToFace" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aUpToFace2" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aUpToShape" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aUpToShape2" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aUseCustomVector"§kfalse"/>§b</Properties></Object>',
        hidden: true,
        stored: 14,
        measure: {
          solids: 1,
          volume: 7999.999999999998,
          area: 2799.9999999999995,
          box: [0.0, 0.0, 0.0, 40.0, 20.0, 10.0],
          centre: [19.999999999999996, 9.999999999999998, 5.0],
        },
      },
      {
        object: 'PocketSketch',
        type: 'Sketcher::SketchObject',
        label: 'PocketSketch',
        xml: '<Object name="PocketSketch" Extensions="True">§l<Properties Count="25" TransientCount="1">§aArcFitTolerance" type="App::PropertyPrecision"><Float value="0.000001"/>§b§aAttacherEngine" type="App::PropertyEnumeration"><Integer value="0" CustomEnum="true"/><CustomEnumList count="4"><Enum value="Engine 3D"/><Enum value="Engine Plane"/><Enum value="Engine Line"/><Enum value="Engine Point"/></CustomEnumList>§b§aAttacherType"§g><String value="Attacher::AttachEnginePlane"/>§b§aAttachmentOffset"§c0" Py="0" Pz="0§d§b§aAttachmentSupport" type="App::PropertyLinkSubList"><LinkSubList count="1"><Link obj="Pad" sub="Face6" shadow=";#14:1;:G0;XTR;:H8c0:8,F.Face6"/></LinkSubList>§b§aConstraints" type="Sketcher::PropertyConstraintList"><ConstraintList count="0"></ConstraintList>§b§i§aExternalGeo" type="Part::PropertyGeometryList"><GeometryList count="2"><Geometry type="Part::GeomLineSegment" id="-1" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="1" EndY="0" EndZ="0"/><Construction value="1"/></Geometry><Geometry type="Part::GeomLineSegment" id="-2" migrated="1"><GeoExtensions count="2"><GeoExtension type="Sketcher::SketchGeometryExtension" id="-2" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000010" geometryLayer="0"/><GeoExtension type="Sketcher::ExternalGeometryExtension" Ref="" Flags="0"/></GeoExtensions><LineSegment StartX="0" StartY="0" StartZ="0" EndX="0" EndY="1" EndZ="0"/><Construction value="1"/></Geometry></GeometryList>§b§aExternalGeometry" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aExternalTypes" type="App::PropertyIntegerList"><IntegerList count="1"><I v="0"/></IntegerList>§b§aGeometry" type="Part::PropertyGeometryList"><GeometryList count="1"><Geometry type="Part::GeomCircle" id="1" migrated="1"><GeoExtensions count="1"><GeoExtension type="Sketcher::SketchGeometryExtension" id="1" internalGeometryType="0" geometryModeFlags="00000000000000000000000000000000" geometryLayer="0"/></GeoExtensions><Circle CenterX="10" CenterY="10" CenterZ="0" NormalX="0" NormalY="0" NormalZ="1" AngleXU="0" Radius="4"/><Construction value="0"/></Geometry></GeometryList>§b§aLabel"§g><String value="PocketSketch"/>§b§aMapMode" type="App::PropertyEnumeration"><Integer value="5"/>§b§aMapPathParameter" type="App::PropertyFloat"><Float value="0"/>§b§aMapReversed"§kfalse"/>§b§aPlacement"§c0" Py="0" Pz="10§d§b§aShape"§hPocketSketch.Shape.brp"/>§b§a_ExternalGeoVersion" type="App::PropertyInteger"><Integer value="1"/>§b</Properties></Object>',
        measure: {
          solids: 0,
          volume: 0.0,
          area: 0.0,
          box: [6.0, 6.0, 10.0, 14.0, 14.0, 10.0],
          centre: null,
        },
      },
      {
        object: 'Pocket',
        type: 'PartDesign::Pocket',
        label: 'Pocket',
        xml: '<Object name="Pocket" Extensions="True"><Extensions Count="2"><Extension type="App::SuppressibleExtension" name="SuppressibleExtension"></Extension><Extension type="Part::PreviewExtension" name="PreviewExtension"></Extension></Extensions><Properties Count="34" TransientCount="3">§aAllowMultiFace"§ktrue"/>§b§aAlongSketchNormal"§ktrue"/>§b§aBaseFeature"§fPad"/>§b§aDirection" type="App::PropertyVector"><PropertyVector valueX="0" valueY="0" valueZ="-1"/>§b§i§aFuzzyTolerance" type="App::PropertyFloatConstraint"><Float value="-1"/>§b§aLabel"§g><String value="Pocket"/>§b§aLength"§e5"/>§b§aLength2"§e5"/>§b§aMidplane"§kfalse"/>§b§aOffset"§e0"/>§b§aOffset2"§e0"/>§b§aPlacement"§c0" Py="0" Pz="0§d§b§aProfile" type="App::PropertyLinkSub"><LinkSub value="PocketSketch" count="0"></LinkSub>§b§aReferenceAxis" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aRefine"§ktrue"/>§b§aReversed"§kfalse"/>§b§aShape" type="Part::PropertyPartShape"><Part HasherIndex="0" ElementMap="15.70200.5" file="Pocket.Shape.brp"/>§b§aSideType" type="App::PropertyEnumeration"><Integer value="0"/>§b§aSuppressed"§kfalse"/>§b§aTaperAngle"§j0"/>§b§aTaperAngle2"§j0"/>§b§aType" type="App::PropertyEnumeration"><Integer value="0"/>§b§aType2" type="App::PropertyEnumeration"><Integer value="0"/>§b§aUpToFace" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aUpToFace2" type="App::PropertyLinkSub"><LinkSub value="" count="0"></LinkSub>§b§aUpToShape" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aUpToShape2" type="App::PropertyLinkSubList"><LinkSubList count="0"></LinkSubList>§b§aUseCustomVector"§kfalse"/>§b</Properties></Object>',
        stored: 15,
        measure: {
          solids: 1,
          volume: 7748.672587712816,
          area: 2925.6637061435913,
          box: [0.0, 0.0, 0.0, 40.0, 20.0, 10.0],
          centre: [20.324348989381377, 10.000000000000004, 4.9189127526546566],
        },
      },
    ],
  },
} as never;
