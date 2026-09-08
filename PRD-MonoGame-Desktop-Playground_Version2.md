# Product Requirements Document: MonoGame Desktop Playground

**Status:** Draft  
**Document date:** August 23, 2026  
**Working product name:** MonoGame Playground  
**Product repository:** New standalone repository, name to be determined  
**MonoGame dependency:** `infinitespace-studios/MonoGame` Git submodule  
**Initial MonoGame branch:** `feature/openglnative`

### Requirement language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described by RFC 2119.

- **MUST** and **MUST NOT** identify release-blocking requirements.
- **SHOULD** and **SHOULD NOT** identify requirements that may be waived only through a documented engineering decision.
- **MAY** identifies optional behavior.

All MVP acceptance criteria and Phase 1 feasibility criteria are mandatory regardless of capitalization elsewhere in this document.

### Architecture amendment — embedded preview (September 8, 2026)

The product preview runs inside the Workbench preview panel as an opaque-origin,
sandboxed iframe. The previously explored separate visible preview window and
forced-termination requirement are superseded by this amendment and ADR 0003.
Stop is cooperative and is guaranteed only for supported user code that returns
control to the MonoGame/browser frame loop. Synchronous non-yielding code—such
as an unbounded `while (true)`, `for (;;)`, blocking recursion, or equivalent
work inside construction, `LoadContent`, `Update`, or `Draw`—is unsupported. It
may freeze the shared WebView and require the user to terminate and relaunch the
application. General finite `while`/`for` loops remain supported; the restriction
is on monopolizing the WebView thread, not on a particular C# keyword.

---

## 1. Product summary

MonoGame Playground is a lightweight desktop application that lets users write ordinary MonoGame C# code and immediately run it without installing the .NET SDK, MonoGame templates, Visual Studio, or other development tools.

The desired experience is similar to XnaFiddle:

- C# editor on the left
- Running game preview on the right
- Run and Stop controls
- Compiler diagnostics and console output below
- Fast iteration while experimenting

Unlike XnaFiddle, the game runtime will use MonoGame's own WebGL backend from the `infinitespace-studios/MonoGame` fork.

The application will be developed in a new, dedicated repository. MonoGame will be included as a Git submodule so that:

- Playground code remains separate from MonoGame framework code.
- The playground can pin an exact tested MonoGame commit.
- MonoGame backend work remains in the MonoGame fork.
- Playground releases can be reproduced against a known framework revision.
- Changes to MonoGame can be developed and reviewed independently.

The desktop UI will be written in TypeScript and packaged as a desktop application. The game preview will run inside a WebView using:

- .NET WebAssembly
- `MonoGame.Framework.Native`
- The MonoGame native Emscripten/WebGL backend
- Dynamically compiled user assemblies

User C# source will be compiled to managed .NET IL, not directly to WebAssembly. The existing .NET WebAssembly runtime will load and execute the resulting assembly.

---

## 2. Repository strategy

## 2.1 Standalone product repository

The playground must be created in a new Git repository.

This repository will contain:

- Desktop shell
- TypeScript frontend
- Monaco editor integration
- Compiler runtime
- Game preview runtime
- Communication contracts
- Example playground projects
- Product documentation
- Build and packaging scripts
- Product-specific tests

It must not place product-specific application code directly into the MonoGame repository.

The final repository name is not prescribed by this document. Possible names include:

- `MonoGame.Playground`
- `MonoGamePlayground`
- `MonoGame.Fiddle`
- `MonoGame.Sandbox`

Until the repository is created, this document refers to it as the **playground repository**.

## 2.2 MonoGame submodule

The playground repository must include:

```text
https://github.com/infinitespace-studios/MonoGame.git
```

as a Git submodule at:

```text
external/MonoGame
```

Initial setup:

```bash
git submodule add \
  -b feature/openglnative \
  https://github.com/infinitespace-studios/MonoGame.git \
  external/MonoGame

git submodule update --init --recursive
```

The parent repository must commit:

- The `.gitmodules` file
- The exact MonoGame submodule commit
- Any scripts needed to validate or update the submodule

A Git submodule ultimately pins a commit, even if `.gitmodules` contains a branch hint. Builds must use the pinned commit and must not silently fetch the latest branch revision.

## 2.3 Initial submodule revision

The initial submodule revision should come from:

```text
Repository: infinitespace-studios/MonoGame
Branch: feature/openglnative
```

The implementation agent must record the selected commit SHA in a versioned toolchain manifest during Phase 0. The feasibility report must reference that manifest.

The parent repository should not depend on an unpinned branch head.

The pinned commit must remain reachable from a protected, non-force-pushed branch or tag in the MonoGame fork.

## 2.4 MonoGame modifications

Changes to the MonoGame framework, WebGL backend, native runtime, or web platform must be committed inside the MonoGame repository.

The expected workflow is:

1. Create or select a branch in `infinitespace-studios/MonoGame`.
2. Make and test MonoGame-specific changes there.
3. Commit and push those changes to the MonoGame fork.
4. Update the submodule pointer in the playground repository.
5. Commit the updated pointer separately in the playground repository.

Product-specific code must remain in the playground repository whenever possible.

A playground-specific submodule change requires an architectural decision record explaining why a general-purpose host API is necessary.

Examples of changes that belong in the MonoGame submodule:

- Configurable WebGL canvas selector
- Web-specific game lifecycle changes
- Emscripten build changes
- WebAssembly input fixes
- Native runtime fixes
- Audio fixes
- ContentManager browser filesystem fixes
- MonoGame framework APIs needed by all WebGL hosts
- Correct WebGL `Game.Exit()` behavior, including cancelling the Emscripten main loop and notifying the JavaScript host

Examples of changes that belong in the playground repository:

- Monaco editor
- Roslyn compiler service
- Project file model
- Preview iframe controller
- TypeScript/.NET communication
- Tauri commands
- Playground UI
- Playground templates
- Product packaging

## 2.5 Submodule update policy

Submodule updates must be intentional and reviewable.

A submodule update should include:

- Previous MonoGame commit SHA
- New MonoGame commit SHA
- Reason for the update
- Relevant MonoGame commits or pull requests
- Tests performed against the new revision
- Known compatibility changes

The product build must not automatically update the submodule.

CI should fail with a clear error if the submodule has not been initialized.

## 2.6 Reproducible toolchain

The playground repository must contain a versioned toolchain manifest that pins:

- MonoGame commit SHA and protected ref
- .NET SDK and runtime
- .NET WebAssembly workload
- Emscripten SDK
- Rust toolchain and Tauri CLI when Tauri is selected
- Electron version when Electron is selected
- Node.js and package manager
- Frontend lockfile
- Native build tools required by MonoGame

CI must restore from lockfiles, verify the manifest, and build on a clean worker. Release artifacts must record the toolchain manifest and hashes of bundled native and WebAssembly artifacts.

---

## 3. Problem statement

Running a basic MonoGame experiment currently requires users to install and understand several pieces of tooling:

- A compatible .NET SDK
- MonoGame project templates
- An editor or IDE
- Project files
- NuGet restore
- Build and run commands
- Potentially the MonoGame content pipeline

This creates significant friction for:

- New users learning MonoGame
- Users experimenting with an API
- Documentation examples
- Small graphical prototypes
- Bug reproductions
- Educational environments
- Shared code samples

The product should reduce the experience to:

1. Open the application.
2. Edit `Game1.cs`.
3. Press **Run**.
4. See the result.
5. Fix any reported errors and run again.

---

## 4. Product vision

Provide the quickest path from an idea to a running MonoGame example while preserving recognizable, portable MonoGame C# code.

Code written in the playground should look like normal MonoGame code and be reusable in a conventional MonoGame project with minimal or no modification.

Example:

```csharp
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

public sealed class Game1 : Game
{
    private readonly GraphicsDeviceManager _graphics;

    public Game1()
    {
        _graphics = new GraphicsDeviceManager(this);
        _graphics.PreferredBackBufferWidth = 800;
        _graphics.PreferredBackBufferHeight = 480;

        Content.RootDirectory = "Content";
        IsMouseVisible = true;
    }

    protected override void Update(GameTime gameTime)
    {
        if (Keyboard.GetState().IsKeyDown(Keys.Escape))
            Exit();

        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        base.Draw(gameTime);
    }
}
```

The user should not need to provide:

- `Program.cs`
- A `.csproj` file
- A solution
- A package reference
- An application entry point

The playground owns the host and entry point.

---

## 5. Goals

## 5.1 Primary goals

1. Allow a user to edit one or more ordinary `.cs` files.
2. Compile those files locally without requiring an installed .NET SDK.
3. Display compiler errors with file, line, and column information.
4. Run a user-defined `Microsoft.Xna.Framework.Game` subclass.
5. Render the game into a preview panel using MonoGame's WebGL backend.
6. Support Run, Stop, and clean restart behavior.
7. Package the complete experience as a desktop application.
8. Preserve normal MonoGame API usage as much as possible.
9. Keep the application reasonably small and quick to install.
10. Work without an internet connection after installation.
11. Keep the playground product isolated from the MonoGame framework repository.
12. Pin every product build to an exact tested MonoGame commit.

## 5.2 Secondary goals

1. Support multiple C# source files.
2. Open and save local project folders.
3. Display `Console.WriteLine` output.
4. Report runtime exceptions with source filenames and line numbers.
5. Load precompiled MonoGame `.xnb` content.
6. Provide starter templates and examples.
7. Allow projects to be exported to a conventional MonoGame project later.

---

## 6. Non-goals for the MVP

The MVP will not attempt to provide:

- A full IDE
- Visual Studio compatibility
- Arbitrary NuGet package installation
- Arbitrary native library loading
- Runtime C# AOT compilation
- A full MGCB content editor
- A complete content build pipeline
- Git integration in the product UI
- Multiplayer collaboration
- Cloud storage
- User accounts
- Online snippet sharing
- Debugger breakpoints
- Edit-and-continue
- True hot reload preserving game state
- A complete security sandbox for deliberately malicious code; the mandatory defence-in-depth boundary in section 16 still applies
- Native DesktopGL rendering
- Mobile deployment
- Publishing finished games directly from the playground
- Automatic tracking of the latest MonoGame branch commit
- Embedding the playground product into the MonoGame source tree

---

## 7. Target users

### 7.1 New MonoGame users

Users who want to learn the framework without first understanding SDK installation, templates, projects, and build tools.

### 7.2 Experienced MonoGame developers

Developers who need a quick environment for:

- Testing an API
- Reproducing a bug
- Trying rendering code
- Creating a minimal example
- Testing framework behavior

### 7.3 Documentation authors

Authors who need runnable examples that use recognizable MonoGame code.

### 7.4 Educators and students

Users who need a consistent, preconfigured environment that works without requiring each student to install an entire development toolchain.

---

## 8. Core user experience

The main application should use a two-column layout.

```text
┌──────────────────────────────────────────────────────────────┐
│ New  Open  Save                         Run  Stop             │
├─────────────────────────────┬────────────────────────────────┤
│ Files                       │ Game preview                   │
│ ├── Game1.cs                │                                │
│ └── Player.cs               │       WebGL canvas             │
│                             │                                │
│ Code editor                 │                                │
│                             │                                │
├─────────────────────────────┴────────────────────────────────┤
│ Problems | Output | Assets                                   │
└──────────────────────────────────────────────────────────────┘
```

## 8.1 Initial launch

On first launch, the application should:

1. Open a default example.
2. Display `Game1.cs` in the editor.
3. Show an inactive preview panel containing the message `Press Run to start the preview`.
4. Make the **Run** button immediately available.
5. Avoid requiring project creation before experimentation.

## 8.2 Run workflow

When the user presses **Run**:

1. Gather all in-memory source files.
2. Send the source files to the compiler runtime.
3. Compile them into a managed assembly and portable PDB.
4. Display diagnostics if compilation fails.
5. If compilation succeeds, stop and dispose of any previous preview.
6. Create a clean preview runtime.
7. Transfer the compiled assembly, PDB, and project assets.
8. Mount all assets before starting the .NET runtime.
9. Locate the user's `Game` subclass.
10. Instantiate it.
11. Call `Run()` and retain the game for the lifetime of the preview.
12. Show the running game in the right-hand preview panel.

## 8.3 Stop workflow

When the user presses **Stop**:

1. Request cooperative termination of the current preview.
2. Cancel the Emscripten main loop.
3. Release WebGL, audio, and communication resources.
4. Close message ports, revoke generated object URLs, and remove the preview iframe.
5. Leave source and compiler state intact.

For supported user code that yields between frames, Stop must return the editor
to an interactive state within 2 seconds on the reference machine.

The MVP intentionally does not host the preview in a separate visible OS window
and does not promise forced recovery from code that monopolizes the shared
WebView thread. Synchronous non-yielding code, including an unbounded loop inside
a game callback, is unsupported and may require terminating and relaunching the
application. Because arbitrary non-termination cannot be detected reliably by
static analysis, this is a documented execution constraint rather than a claim
that every possible infinite loop will be rejected before Run.

## 8.4 Compilation failure

If compilation fails:

- An existing preview must continue running unchanged.
- No new preview may be created.
- The Problems panel should become visible.
- Each diagnostic should include:
  - Severity
  - Diagnostic ID
  - Message
  - Filename
  - Line
  - Column
- Selecting a diagnostic should move the editor cursor to its source location.
- Error markers should appear in the editor.

## 8.5 Runtime failure

If the game throws an unhandled exception:

- The preview should stop.
- The exception should appear in the Output panel.
- User-code stack frames must include source filenames and line numbers when the PDB produced by the current compilation is available.
- The editor must remain responsive.

## 8.6 Project lifecycle

- Run must compile the current in-memory source, including unsaved changes.
- New, Open, and application exit must prompt before discarding unsaved changes.
- Save on a scratch project must open a Save As flow.
- Opening another project must stop the running preview before replacing editor state.
- Project and manifest writes must be atomic and preserve a backup until the new version is committed successfully.

---

## 9. Technical architecture

## 9.1 High-level architecture

```text
Playground desktop application
│
├── TypeScript application
│   ├── Application layout
│   ├── Monaco editor
│   ├── Project/file management
│   ├── Problems panel
│   ├── Output panel
│   └── Preview controller
│
├── Persistent compiler context
│   ├── .NET WebAssembly runtime
│   ├── Roslyn
│   ├── Framework reference assemblies
│   ├── MonoGame reference assembly
│   └── Compile source → DLL + PDB
│
├── Replaceable preview iframe
│   ├── Fresh .NET WebAssembly runtime
│   ├── MonoGame.Framework.Native
│   ├── Native Emscripten/WebGL backend
│   ├── UserGame.dll
│   ├── UserGame.pdb
│   └── Project assets
│
└── external/MonoGame
    └── Git submodule pinned to an exact commit
```

## 9.2 Desktop shell

The preferred initial desktop shell is Tauri.

Reasons:

- TypeScript-based frontend
- Smaller package than Electron
- Local filesystem support
- Uses the platform WebView
- Can bundle application resources
- Does not require .NET to be installed

Electron may be used instead if WebView compatibility, WebAssembly threading, WebGL, or custom protocol restrictions make Tauri impractical.

The feasibility phase must validate Tauri before treating it as the final shell. The shell selection must be recorded in an architectural decision record at the end of Phase 1. Electron must be evaluated if Tauri cannot satisfy any mandatory Phase 1 isolation, lifecycle, WebAssembly, or packaging criterion.

## 9.3 Frontend

The frontend should use:

- TypeScript
- Monaco Editor
- Standard browser APIs where practical
- Tauri APIs only in the trusted top-level application

React, Vue, Svelte, or a framework-free implementation are acceptable.

## 9.4 Game runtime

The game runtime should be built from:

```text
external/MonoGame/MonoGame.Framework/MonoGame.Framework.Native.csproj
external/MonoGame/Example/Example.Web.csproj
external/MonoGame/native/monogame
```

The exact MonoGame example should be treated as a reference implementation. Product-specific preview code should live in the playground repository.

The runtime will use:

- `MonoGame.Framework.Native`
- The Emscripten build of the MonoGame native runtime
- WebGL 2
- SDL's Emscripten support
- FAudio or the current web audio implementation
- The .NET browser WebAssembly runtime

## 9.5 Compilation model

User source must not be compiled to a new native WebAssembly module for every run.

Instead:

```text
Game1.cs
Player.cs
    │
    ▼
Roslyn CSharpCompilation
    │
    ├── UserGame.dll
    └── UserGame.pdb
             │
             ▼
Existing .NET WebAssembly runtime
             │
             ▼
Assembly.Load(...)
```

The base preview application is built ahead of time and includes:

- The .NET runtime
- MonoGame managed code
- The MonoGame native runtime
- The WebGL backend
- Required native dependencies

User code is compiled to normal managed IL and executed by the existing .NET WebAssembly runtime.

## 9.6 Dynamic-code runtime contract

The preview runtime must:

- Pin an exact .NET SDK and runtime version.
- Keep WebAssembly interpreter support enabled for dynamically loaded IL.
- Disable AOT-only execution for user assemblies.
- Either disable trimming or root the complete supported public API surface, including `MonoGame.Framework.Native`, `netstandard`, reflection metadata, and required runtime facades.
- Load the emitted portable PDB with the assembly.
- Resolve dependencies only from a documented, versioned allowlist.
- Produce deterministic diagnostics for unsupported assemblies and APIs.

The Release-packaged application, not only a development build, must prove this contract during Phase 1.

## 9.7 Compiler and preview protocol

`src/shared/Protocol.md` must define the only allowed communication between the top-level application, compiler context, and preview context.

Every message must include:

- Protocol version
- Message type
- Correlation ID
- Validated payload schema
- Success or structured error result

The protocol must define:

- Binary transfer representation for assemblies, PDBs, and assets
- Maximum request and asset sizes
- Timeouts and cancellation
- Compiler diagnostics and playground-owned diagnostics
- Preview lifecycle events, including started, stopped, exited, failed, and output
- Asset path normalization and recursive directory creation
- Backward-compatibility rules

The implementation should use transferable binary buffers rather than Base64 after the initial spike.

---

## 10. Proposed repository layout

The standalone playground repository should initially use this structure:

```text
/
├── .github/
│   └── workflows/
│
├── docs/
│   ├── PRD.md
│   ├── architecture.md
│   ├── build.md
│   ├── submodule-workflow.md
│   └── feasibility-report.md
│
├── examples/
│   ├── HelloWorld/
│   │   ├── Game1.cs
│   │   └── playground.json
│   └── ContentExample/
│
├── external/
│   └── MonoGame/                    # Git submodule
│
├── scripts/
│   ├── bootstrap.ps1
│   ├── bootstrap.sh
│   ├── build-monogame.ps1
│   ├── build-monogame.sh
│   ├── build.ps1
│   └── build.sh
│
├── src/
│   ├── desktop/
│   │   ├── src-tauri/
│   │   └── package.json
│   │
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── editor/
│   │   │   ├── projects/
│   │   │   ├── compiler/
│   │   │   ├── preview/
│   │   │   ├── problems/
│   │   │   └── output/
│   │   └── public/
│   │
│   ├── compiler/
│   │   ├── Playground.Compiler.csproj
│   │   ├── CompilationService.cs
│   │   ├── CompilerExports.cs
│   │   └── References/
│   │
│   ├── preview/
│   │   ├── Playground.Preview.csproj
│   │   ├── GameRunner.cs
│   │   ├── PreviewExports.cs
│   │   └── wwwroot/
│   │
│   └── shared/
│       ├── MessageContracts.ts
│       └── Protocol.md
│
├── tests/
│   ├── compiler/
│   ├── preview/
│   └── integration/
│
├── .gitmodules
├── .gitignore
├── README.md
└── LICENSE
```

The implementation agent may adapt this layout when justified, but must preserve the separation between:

- Desktop shell
- Frontend
- Compiler
- Preview runtime
- Shared contracts
- MonoGame submodule

---

## 11. Bootstrap and build requirements

## 11.1 Clone instructions

Documentation must instruct developers to clone recursively:

```bash
git clone --recursive <playground-repository-url>
```

For an existing clone:

```bash
git submodule update --init --recursive
```

## 11.2 Bootstrap scripts

The repository should provide:

```text
scripts/bootstrap.ps1
scripts/bootstrap.sh
```

For the current development workspace, the Emscripten SDK is expected in the directory beside the playground repository:

```text
../emsdk
```

Before running MonoGame native or WebAssembly builds on macOS or Linux, developers must initialize the Emscripten environment in their current shell:

```bash
source ../emsdk/emsdk_env.sh
```

This command must be run with `source` because `emsdk_env.sh` configures environment variables in the current shell process. Documentation must note that executing the script as a child process does not persist the required environment.

MonoGame must then be built before the playground. From the playground repository root:

```bash
source ../emsdk/emsdk_env.sh
cd external/MonoGame
dotnet run --project build/Build.csproj
cd ../..
```

The MonoGame build must run in the same shell that sourced `emsdk_env.sh`, so its native Emscripten/WebAssembly build steps inherit the required environment. Playground build scripts must not begin until this command completes successfully and the expected MonoGame native artifacts exist.

These scripts should:

1. Verify that `external/MonoGame` is initialized.
2. Verify that the expected files exist.
3. Report the pinned MonoGame commit.
4. Check required development tools.
5. Restore frontend dependencies.
6. Restore .NET projects.
7. Avoid modifying the submodule revision automatically.
8. Verify the complete toolchain manifest.
9. Verify or restore the pinned .NET WebAssembly workload.
10. Verify the pinned Emscripten SDK and native build tools.
11. Obtain native MonoGame artifacts either from a reproducible build or from verified artifacts keyed by submodule SHA.
12. Detect when the Emscripten environment is not initialized and report the exact `source ../emsdk/emsdk_env.sh` command.
13. Build MonoGame first with `dotnet run --project build/Build.csproj` from `external/MonoGame`, unless verified artifacts for the exact submodule SHA and toolchain are already present.
14. Verify expected MonoGame native artifacts before building the playground.

## 11.3 Submodule validation

Build scripts should fail with an actionable error if the submodule is absent.

Example:

```text
MonoGame submodule is not initialized.

Run:

    git submodule update --init --recursive
```

CI should also verify that:

- The submodule revision exists.
- The submodule checkout is clean.
- Product builds do not depend on uncommitted submodule changes.
- The pinned commit is reachable from its protected ref.
- Toolchain and lockfile versions match the versioned manifest.
- Native artifact hashes match the pinned submodule and toolchain.

## 11.4 Build outputs

MonoGame build outputs required by the playground may be copied into a generated staging directory.

Suggested location:

```text
artifacts/monogame/
```

The playground should not write generated product files into the submodule except where the MonoGame build itself requires its normal artifact directories.

The `artifacts/` directory should not be committed unless a future release process explicitly requires checked-in binaries.

---

## 12. Compiler requirements

## 12.1 Compiler service

The compiler service should use Roslyn's `CSharpCompilation` API.

It must accept:

- One or more source files
- Each file's logical path
- Optional compilation settings

It must return:

- Success or failure
- Managed assembly bytes
- Portable PDB bytes
- Structured diagnostics

Suggested result model:

```csharp
public sealed record CompilationResult(
    bool Success,
    byte[]? Assembly,
    byte[]? Pdb,
    IReadOnlyList<CompilerDiagnostic> Diagnostics);
```

## 12.2 Compilation settings

Initial settings should be:

- Output kind: dynamically linked library
- Optimization: debug
- Portable PDB enabled
- Unsafe code disabled by default
- Nullable context disabled by default for compatibility with common MonoGame samples
- A fixed supported C# language version
- Deterministic syntax, reference, and diagnostic inputs
- A unique assembly name for load isolation, acknowledging that emitted binaries are not byte-for-byte deterministic across runs
- Warnings reported but not treated as errors by default

## 12.3 Compiler references

The compiler must use a controlled, versioned allowlist of metadata references generated from the pinned runtime and MonoGame revision. The initial allowlist must cover:

- Core runtime types
- `System.Runtime`
- `System.Console`
- `System.Collections`
- `System.Linq`
- `System.Numerics`
- `System.Numerics.Vectors`
- `System.Threading`
- `System.Threading.Tasks`
- `System.Runtime.InteropServices`
- `System.Memory`
- `System.Diagnostics.Debug`
- `netstandard`
- `MonoGame.Framework.Native`

The MonoGame compiler reference must be produced from the pinned submodule revision, not downloaded independently from an unrelated NuGet package version.

The application should bundle raw assemblies suitable for Roslyn metadata references.

The reference allowlist and the preview runtime assemblies must be generated from the same toolchain manifest. CI must fail if their assembly identities drift.

The repository must publish a versioned supported-API policy containing:

- Allowed assembly identities
- Allowed and prohibited namespaces, types, and members
- Reflection behavior and rooted reflection metadata
- Exact handling of `DllImport`, `UnmanagedCallersOnly`, `Marshal`, unsafe code, indirect native calls, and JavaScript interop
- The analyzer diagnostic associated with each prohibited category

Trimming roots and Release compatibility fixtures must be derived from this policy. An assembly allowlist alone is not considered an API or security boundary.

The compiler must emit clear playground-owned diagnostics for:

- No concrete `Game` subclass
- More than one concrete `Game` subclass
- Missing public parameterless constructor
- Unsupported assembly or namespace references
- Direct `DllImport`, `UnmanagedCallersOnly`, or unsafe indirect native calls

## 12.4 Compiler isolation

Compilation must not make editor input unresponsive for more than 100 ms at a time on the reference machine.

Preferred implementation:

- A dedicated worker or separately scheduled WebView with a persistent .NET WebAssembly runtime

A hidden same-WebView iframe may be used only during the initial spike. It does not satisfy the product isolation or responsiveness requirement unless Phase 1 measurements demonstrate that Roslyn compilation meets the input-responsiveness budget.

The compiler context should remain alive between runs.

## 12.5 Compiler interoperability

The compiler runtime should expose a managed method to JavaScript.

Initial interface:

```csharp
[JSExport]
public static string Compile(string requestJson);
```

The initial spike may return DLL and PDB bytes as Base64 strings. The MVP must use transferable binary buffers unless measured evidence shows that Base64 remains within the protocol's memory and latency limits.

---

## 13. Game runner requirements

## 13.1 Runner-owned entry point

Users should not need a `Program.Main`.

The runner should:

1. Load the compiled assembly.
2. Inspect its types.
3. Find concrete types deriving from `Microsoft.Xna.Framework.Game`.
4. Validate the result.
5. Construct the game.
6. Run it.

On the WebGL platform, `Game.Run()` schedules an asynchronous Emscripten loop and returns. The runner must retain a strong reference to the game, must not wrap it in a scope that disposes it after `Run()` returns, and must keep the managed host alive until the preview is stopped or the game exits.

## 13.2 Game type rules

For the MVP:

- Exactly one non-abstract `Game` subclass must exist.
- The class must have a public parameterless constructor.
- The class may be in any namespace.
- The class does not have to be named `Game1`.

Validation failures must be returned as structured playground diagnostics and displayed in the Problems panel before `Game` construction.

## 13.3 Preview lifecycle

A fresh preview context should be created on every successful run.

For the MVP, the preview should be an iframe containing:

- Its own canvas
- Its own .NET runtime
- Its own MonoGame state
- Its own loaded user assembly

Destroying and recreating the iframe is the required reset mechanism.

Do not initially attempt to unload and replace user assemblies inside one runtime.

The preview lifecycle must define these states:

```text
stopped → starting → running → stopping → stopped
                     └──────→ failed → stopped
```

`Game.Exit()` must cancel the WebGL main loop and emit an `exited` protocol event. The preview controller must then perform the same cleanup as Stop.

## 13.4 Canvas selection

The current WebGL backend assumes a hard-coded `#canvas` selector.

For the initial product, each preview iframe must contain exactly one element with `id="canvas"`.

A configurable canvas selector is deferred until a concrete multi-canvas or embedding requirement exists because the current selector is implemented in native code and requires a native rebuild.

Any corresponding framework change must be:

1. Committed in `infinitespace-studios/MonoGame`.
2. Tested in the MonoGame repository.
3. Pushed to a branch.
4. Referenced by updating the parent repository's submodule pointer.

---

## 14. TypeScript application requirements

## 14.1 Monaco editor

The editor must support:

- C# syntax highlighting
- Line numbers
- Multiple files
- Find and replace
- Undo and redo
- Error markers
- Diagnostic navigation
- Standard copy and paste
- Configurable font size

Full Roslyn-backed IntelliSense is not required for the MVP.

## 14.2 Problems panel

The Problems panel must display:

- Severity
- Diagnostic ID
- Message
- Filename
- Line
- Column

Selecting a diagnostic should focus its source location.

## 14.3 Output panel

The Output panel should receive:

- `Console.WriteLine`
- `Console.Error`
- Game startup messages
- Runtime exceptions
- Content loading errors
- Shader errors
- Preview lifecycle messages

The preview must capture and tag both managed `Console.Out`/`Console.Error` and native Emscripten `Module.print`/`Module.printErr` output.

## 14.4 Preview panel

The preview panel should:

- Contain the game iframe and canvas
- Support resizing
- Show loading status
- Show stopped status
- Show runtime errors
- Receive keyboard input only while focused
- Avoid stealing Monaco keyboard input

## 14.5 Toolbar

The initial toolbar should contain:

- New
- Open
- Save
- Run
- Stop

The toolbar and application exit flow must expose dirty-state behavior described in section 8.6.

## 14.6 Visual design direction

The selected visual direction is **Workbench**, represented by the interactive prototype in:

```text
frontend-designs/workbench.html
```

Workbench uses a compact industrial-tool aesthetic suited to a game-development utility:

- Dense but clearly separated editor, preview, project, and diagnostics regions
- Tactile toolbar controls with prominent Run and Stop states
- Monospaced operational labels and runtime telemetry
- Strong visual distinction between source editing and live preview
- Restrained motion used to communicate compilation, running, and stopping states
- Responsive layouts that preserve editor and preview usability on smaller windows

The product must provide both Workbench variants:

- **Dark:** graphite panels, amber primary controls, and green runtime indicators
- **Light:** warm drafting-bench panels, safety-orange primary controls, and dark technical text

Both themes must preserve identical information hierarchy and behavior. Theme selection must respect the operating-system preference on first launch, remain user-selectable, and persist locally. Color must not be the only indication of runtime state, diagnostics, selection, or focus. Text, controls, focus indicators, and diagnostic states must meet WCAG 2.2 AA contrast requirements.

---

## 15. Project and content model

Suggested project layout:

```text
MyGame/
├── Game1.cs
├── Player.cs
├── playground.json
└── Content/
    ├── player.xnb
    └── jump.xnb
```

Example manifest:

```json
{
  "name": "My Game",
  "schemaVersion": 1,
  "contentProfile": "Web",
  "preview": {
    "width": 800,
    "height": 480
  }
}
```

The manifest should not be required for a one-file scratch project.

The MVP must support a documented subset of precompiled Web-profile `.xnb` content. MGCB integration and content compilation remain out of scope.

The MVP content contract is:

- Assets must be built with the MonoGame Web content profile matching the pinned MonoGame revision.
- The application must reject a non-Web `.xnb` platform marker before preview startup and explain how to rebuild it with `MonoGamePlatform=Web`.
- The initial supported subset is uncompressed `Texture2D` and non-streaming `SoundEffect` content.
- Custom `Effect` content, video, streaming audio, and platform-specific compressed textures are not supported until separately validated.
- Built-in examples must include known-good Web-profile assets so users without MGCB can run the content example.
- `Content.RootDirectory`, nested asset paths, path normalization, and missing/incompatible-content diagnostics must be defined and tested.

The manifest schema must be published. New application versions must either migrate older schemas atomically or reject unsupported versions without modifying the project.

Manifest preview dimensions set the initial panel size. A user's `GraphicsDeviceManager` back-buffer settings control the render resolution after game initialization. User resizing must raise the normal MonoGame resize behavior and must not silently rewrite the manifest.

---

## 16. Security requirements

The application is intended primarily for users running their own local code. The MVP provides defence in depth against accidental or opportunistic access to desktop privileges, but it does not claim to be a complete sandbox for deliberately malicious code. Every newly opened project must display this limitation before its first execution. The acknowledgement must be persisted against a stable project identity and repeated if that identity materially changes.

```text
Trusted
├── Desktop shell host
├── Top-level TypeScript application
└── Project file service

Less trusted
├── Compiler context
└── Game preview context

Untrusted
└── User C# code
```

The preview must not have direct access to:

- Desktop-shell filesystem commands
- Process execution
- Shell access
- Arbitrary native commands
- Application secrets
- Unrestricted desktop APIs

Desktop-shell commands and IPC must only be exposed to the trusted top-level frontend.

The preview and compiler contexts must:

- Use sandboxed opaque origins or distinct origins from the trusted application.
- Omit `allow-same-origin` unless an architectural review proves an equivalent boundary.
- Disable global shell bindings and scope Tauri capabilities or Electron IPC handlers to the trusted top-level WebView.
- Apply restrictive `default-src`, `script-src`, `frame-src`, `connect-src`, and navigation policies.
- Validate protocol version, message source, message type, and payload schema.
- Prevent preview navigation and arbitrary network access.
- Exclude JavaScript interop and direct native interop assemblies from compiler references unless explicitly approved.

Phase 1 must verify that these restrictions remain compatible with `.NET` startup, WebGL, asset loading, and the selected shell. Minimum isolation may not be deferred to product hardening.

---

## 17. Performance and package requirements

Phase 0 must define and record a reference Windows machine or VM, including CPU, memory, GPU/WebGL implementation, Windows version, WebView2 version, and storage type. Measurements must use versioned benchmark projects and report cold and warm p50 and p95 values over at least ten runs.

### Startup

- Application shell visible within 3 seconds on the reference machine.
- Editor input must remain responsive while the compiler initializes.

### Compilation

For a small project of up to five source files:

- Warm compilation p95 must be under 2 seconds.
- Cold compiler initialization p95 must be under 5 seconds.
- The benchmark project and maximum supported aggregate source size must be recorded.
- Compiler memory after 100 consecutive compilations must remain within 10% of its stabilized baseline after garbage collection.

### Preview startup

- Preview visibly active within 3 seconds after successful compilation at p95.
- A loading indicator must be shown.
- For supported user code that yields between frames, Stop must return control to the editor within 2 seconds.

### Memory and lifecycle

- Phase 1 must record cold, running, and peak process RSS.
- Twenty consecutive Run/Stop cycles must not increase stabilized process RSS by more than 20%.
- A stopped preview must have no continuing audio, animation frames, WebGL context, message ports, or retained user static state.
- If these limits cannot be met on an 8 GB reference system, the architecture must be reconsidered.

### Package size

Initial target:

- Under 100 MB for the compressed release artifact
- Under 50 MB compressed as a stretch goal

Exceeding 100 MB blocks release unless an engineering waiver records the measured breakdown and accepted user impact.

The feasibility report must include a size breakdown for:

- Desktop shell
- Frontend
- Monaco
- Compiler runtime
- Roslyn
- Reference assemblies
- Preview runtime
- MonoGame managed assemblies
- MonoGame native WebAssembly payload
- Audio dependencies

Release native and WebAssembly artifacts must be built without development symbols, verbose Emscripten output, or source maps unless they are shipped separately as debugging artifacts.

---

## 18. Offline requirements

The installed application must work without an internet connection.

The package must include:

- Frontend assets
- Monaco assets
- .NET WebAssembly runtime
- Roslyn assemblies
- Compiler references
- MonoGame assemblies
- Native WebAssembly artifacts
- Built-in examples
- Required JavaScript boot files

No runtime dependency may be loaded from a CDN.

The MonoGame submodule is a development-time source dependency and must not be required on the end user's machine.

---

## 19. Critical feasibility questions

The feasibility phase must answer:

1. Can the existing MonoGame web example run inside the packaged candidate desktop shell?
2. Does it work without a development server?
3. Does it work offline?
4. Do WebGL 2, input, audio, and resizing work?
5. Can the preview remain non-threaded, avoiding SharedArrayBuffer and cross-origin-isolation requirements?
6. Can the required iframe sandbox and origin policy be provided without breaking `.NET`, WebGL, audio, or asset loading?
7. Can Roslyn compile source inside browser WebAssembly?
8. Can Roslyn use references built from the MonoGame submodule?
9. Can the generated DLL and PDB be loaded dynamically?
10. Can the loaded `Game` subclass call into the statically linked MonoGame runtime?
11. Does destroying the preview iframe stop rendering and audio?
12. Can precompiled `.xnb` files be mounted dynamically?
13. What changes are required inside the MonoGame submodule?
14. Can those changes remain general-purpose rather than playground-specific?
15. What is the resulting package size and startup time?
16. Does a Release-packaged build preserve the full supported dynamic-code API surface after trimming?
17. Does `Game.Exit()` cancel the WebGL loop and notify the host?
18. Does cooperative Stop reliably clean up yielding games, and is the unsupported behavior of synchronous non-yielding user code documented clearly?
19. Can portable PDBs map a runtime exception to the correct source file and line?
20. Can Web-profile content be validated and mounted before runtime startup?
21. Does the compiler meet the editor input-responsiveness budget?
22. What are the peak and stabilized memory costs of two WebAssembly runtimes?

---

## 20. Feasibility spike

## 20.1 Deliverable

Create a minimal standalone desktop application in the new playground repository that:

1. Includes MonoGame as `external/MonoGame`.
2. Builds against the pinned submodule revision.
3. Uses a TypeScript frontend.
4. Displays a basic editor on the left.
5. Displays the MonoGame web preview on the right.
6. Initially packages and runs through Tauri; if Tauri fails a mandatory criterion, repeats the same spike through Electron.
7. Works offline.
8. Compiles multiple C# source files using Roslyn.
9. Loads the emitted assembly and portable PDB into the preview.
10. Finds and runs its `Game` subclass.
11. Mounts nested Web-profile content before runtime startup.
12. Stops and restarts by recreating the preview iframe.
13. Executes through the same Release packaging and publish settings intended for the MVP.
14. Applies the proposed preview sandbox, CSP, shell-specific privilege/IPC controls, and message-validation policy.

## 20.2 Acceptance criteria

The spike is successful if:

- The app launches without an installed .NET runtime or SDK.
- The MonoGame submodule can be initialized using documented commands.
- The build records and uses the exact pinned MonoGame commit.
- The existing web example renders successfully.
- Input works when the preview is focused.
- Roslyn emits a valid managed assembly.
- Multiple generated assemblies can call across source files and use representative MonoGame APIs, reflection, LINQ, numerics, exceptions, and supported content.
- Unsupported APIs and invalid game types produce structured diagnostics.
- A generated `Game` subclass can be executed without being disposed when `Run()` returns.
- `Game.Exit()` cancels the game loop and returns the preview to stopped state.
- An exception in user code reports the correct source file and line from the portable PDB.
- Stop returns control within 2 seconds for supported user code that yields between frames; synchronous non-yielding user code is explicitly documented as unsupported and may require application relaunch.
- Stop and Run work at least twenty consecutive times within the memory and lifecycle limits in section 17.
- Compiler diagnostics return to TypeScript.
- Compiler work meets the editor responsiveness requirement.
- Preview code cannot invoke Tauri or Electron host IPC, access project files, navigate the host, make arbitrary network requests, or successfully send forged protocol messages.
- Web-profile assets are mounted before `LoadContent`; incompatible content is rejected with an actionable diagnostic.
- The package works without a development server.
- The package works with networking disabled.
- Package size, timings, peak memory, stabilized memory, and lifecycle cleanup are documented.
- Release trimming or rooting preserves the supported MonoGame API surface used by the compatibility fixtures.
- Any required MonoGame changes are committed separately in the submodule repository.

## 20.3 Failure criteria

The architecture should be reconsidered if:

- Tauri cannot reliably provide required WebAssembly features.
- The candidate shell cannot support the required non-threaded runtime, or the runtime unexpectedly requires shared memory that is incompatible with the isolation boundary.
- Roslyn cannot run or consumes unacceptable memory.
- Dynamic assemblies cannot be loaded.
- Supported, cooperatively yielding preview contexts cannot be stopped and cleaned up reliably.
- Required isolation is incompatible with the runtime.
- The compressed release artifact exceeds 100 MB without an approved waiver.

If Tauri is the only blocker, repeat the complete spike with Electron before abandoning the WebGL design. Electron must satisfy the same Release, offline, isolation, lifecycle, memory, and package criteria using Electron-equivalent IPC and privilege controls.

---

## 21. Functional requirements

- **FR-001:** Edit one or more C# source files.
- **FR-002:** Compile all project `.cs` files together.
- **FR-003:** Display structured compiler diagnostics.
- **FR-004:** Support a normal `Game` subclass.
- **FR-005:** Do not require `Program.Main`.
- **FR-006:** Discover and instantiate the user's game.
- **FR-007:** Render through MonoGame's WebGL backend.
- **FR-008:** Stop the current game.
- **FR-009:** Restart with clean runtime state.
- **FR-010:** Capture console output.
- **FR-011:** Report runtime exceptions without terminating the editor.
- **FR-012:** Open and save local project folders.
- **FR-013:** Operate offline.
- **FR-014:** Load precompiled `.xnb` content.
- **FR-015:** Resize the preview.
- **FR-016:** Route keyboard input according to focus.
- **FR-017:** Build against the exact MonoGame submodule revision.
- **FR-018:** Fail clearly when the submodule is not initialized.
- **FR-019:** Load dynamically compiled assemblies in the Release-packaged runtime without trimming or AOT failures.
- **FR-020:** Map user runtime exceptions to the current source file and line.
- **FR-021:** Prevent preview code from invoking privileged desktop APIs or navigating the trusted host.
- **FR-022:** Validate all compiler and preview protocol messages.
- **FR-023:** Stop rendering, audio, WebGL, and user execution within the lifecycle budget.
- **FR-024:** Preserve unsaved work across New, Open, Save As, and application-exit flows.
- **FR-025:** Reject incompatible content profiles with actionable diagnostics.
- **FR-026:** Build with the complete pinned toolchain manifest.
- **FR-027:** Capture managed and native preview output.
- **FR-028:** Warn before first execution of every newly opened project and persist acknowledgement against its stable identity.

---

## 22. Testing requirements

## 22.1 Compiler tests

Test:

- Empty source
- Valid `Game` subclass
- Syntax errors
- Multiple source files
- Missing `Game` subclass
- Multiple `Game` subclasses
- Missing parameterless constructor
- MonoGame namespace imports
- Portable PDB line mapping
- Unsupported API references
- Direct native interop rejection
- Reference/runtime assembly identity
- Repeated-compilation memory stability
- Protocol request size and cancellation
- Supported-API policy and analyzer coverage for every prohibited category

## 22.2 Runner tests

Test:

- Assembly loading
- Game discovery
- Game construction
- Runtime exceptions
- `Game.Exit()`
- Cooperative Stop followed by iframe removal
- Clear warning/documentation for unsupported synchronous non-yielding callbacks
- Twenty consecutive Run/Stop cycles
- Static-state reset
- Console output capture
- Native Emscripten output capture
- WebGL, audio, message-port, and object-URL cleanup
- Recovery by application relaunch after an intentionally non-yielding preview test

## 22.3 Rendering tests

Test:

- Clear and present
- `SpriteBatch`
- Texture loading
- Render targets
- Keyboard input
- Mouse input
- Canvas resizing
- Audio
- Editor/preview focus switching
- Audio activation in a newly created preview
- WebGL context loss without blocking dialogs

## 22.4 Repository tests

Test:

- Fresh recursive clone
- Clone without submodule, producing an actionable error
- Submodule initialization
- Build against the pinned commit
- Detection of dirty submodule state
- Detection of a missing native MonoGame artifact
- Reproducible clean build
- Toolchain manifest and lockfile enforcement
- Pinned commit reachability from a protected ref
- Native artifact hash validation

## 22.5 Packaging tests

Test on a clean Windows machine or VM with:

- No .NET runtime
- No .NET SDK
- No MonoGame installation
- No Node.js
- No repository checkout
- Networking disabled

The test matrix must define the supported Windows versions, CPU architectures, and minimum WebView2 version. Phase 1 must also perform a macOS smoke test for `.NET` startup, WebAssembly MIME handling, WebGL 2, input, and sandbox compatibility to reduce later cross-platform architecture risk.

Packaging tests must also verify:

- ZIP and/or installer artifact integrity
- Code-signing policy
- Install, launch, upgrade, uninstall, and clean removal behavior
- Bundled third-party notices and SBOM
- No external runtime URLs in the built output
- No undeclared dependency on repository or developer-machine files

## 22.6 Security and project lifecycle tests

Test:

- First-run warning for every newly opened project
- Persistence and invalidation of project warning acknowledgement
- Preview denial of shell IPC and project filesystem access
- Host navigation and arbitrary network denial
- Forged, unknown-version, oversized, and malformed protocol messages
- Cooperative Stop and cleanup for yielding games
- Documented unsupported behavior for synchronous non-yielding user code

---

## 23. MVP acceptance criteria

The MVP is complete when:

1. A Windows user can install or extract the application.
2. The application starts without .NET being installed.
3. A default `Game1.cs` appears in the editor.
4. Pressing Run compiles it locally.
5. The game renders through MonoGame's WebGL backend.
6. Editing the clear color and rerunning changes the preview.
7. Syntax errors show correct source locations.
8. Multiple `.cs` files compile together.
9. `Console.WriteLine` appears in Output.
10. Native MonoGame and Emscripten output appears in Output.
11. A runtime exception reports the correct user source file and line without terminating the editor.
12. For supported user code that yields between frames, `Game.Exit()` and Stop terminate rendering and audio within 2 seconds.
13. Running again starts with clean state and twenty cycles stay within the lifecycle and memory limits.
14. A local project can be opened, saved, and protected from accidental loss of unsaved changes.
15. A known-good Web-profile `.xnb` texture and sound can be loaded.
16. An incompatible `.xnb` is rejected before preview startup with an actionable diagnostic.
17. Every newly opened project displays the code-execution warning before first Run and persists acknowledgement against its stable identity.
18. Preview code cannot invoke privileged desktop APIs, navigate the host, or bypass protocol validation.
19. The Release-packaged runtime loads representative dynamically compiled MonoGame code without trimming or AOT failures.
20. The application works offline.
21. The product resides in its own repository.
22. MonoGame is included as `external/MonoGame`.
23. The build uses the exact MonoGame commit and complete pinned toolchain manifest.
24. Developers can build from a recursive clone using documented steps.
25. The supported Windows release artifact installs or extracts, upgrades, launches, and uninstalls on a clean machine.
26. Package size, startup, compilation, preview startup, and memory remain within section 17 limits.

---

## 24. Delivery phases

## Phase 0: Repository bootstrap

Deliver:

- New standalone repository
- Base directory structure
- `external/MonoGame` submodule
- Pinned `feature/openglnative` commit
- Bootstrap scripts
- Initial CI validation
- Build documentation
- Versioned toolchain manifest and lockfiles
- Protected MonoGame ref for the pinned commit
- Reproducible or verified native artifact workflow
- Supported Windows and WebView2 baseline

## Phase 1: Technical feasibility

Deliver:

- All deliverables and acceptance criteria in section 20
- Existing MonoGame web example inside the candidate desktop shell
- Release-packaged offline rendering
- Input, audio, resizing, and content validation
- A bounded content fixture proving Web-profile validation, nested mounting, and texture/audio loading through the final runtime contract
- Multi-file Roslyn compilation and portable PDB proof
- Dynamic assembly-loading proof under final trimming/interpreter settings
- Enforced preview isolation and protocol validation
- `Game.Exit()`, cooperative Stop, documented non-yielding-code limitation, and twenty-cycle lifecycle proof
- Required general-purpose MonoGame submodule changes
- Shell-selection architectural decision record
- Size, timing, and memory report

Do not build the complete editor before this phase succeeds.

## Phase 2: Minimal playground

Deliver:

- Monaco editor
- One-file project
- Run and Stop
- Compiler diagnostics
- Game preview
- Console output
- Default example
- Unsaved-change protection

## Phase 3: Local projects

Deliver:

- Multiple source files
- File explorer
- Open folder
- Save and Save All
- Recent projects
- Basic manifest
- Manifest schema, migration, and atomic writes

## Phase 4: Content

Deliver:

- Production precompiled `.xnb` project discovery and workflow
- Production asset transfer UX built on the Phase 1 protocol
- User-facing content errors in Output
- Polished texture and audio example using the Phase 1 fixtures
- Documented Web-profile content production workflow
- Expanded content-type compatibility only after fixture validation

## Phase 5: Product hardening

Deliver:

- Isolation hardening beyond the mandatory Phase 1 boundary
- Performance optimization
- Reduced binary transfer overhead
- Package-size optimization
- Installer hardening and signing automation
- Automated tests

## Phase 6: Additional platforms

Deliver:

- macOS investigation and packaging
- Linux investigation
- Platform-specific compatibility fixes

---

## 25. Risks and mitigations

### Roslyn package size and memory use

**Mitigation:**

- Keep one persistent compiler runtime.
- Bundle only required compiler assemblies.
- Reuse metadata references.
- Limit project size.
- Record cold and warm memory use.

### WebAssembly shared-memory restrictions

**Mitigation:**

- Test this before editor development.
- Prefer a non-threaded playground build.
- Configure application protocol policies where possible.
- Fall back to Electron if required.

### Preview cannot stop cleanly

**Mitigation:**

- Run each game in a replaceable, sandboxed iframe embedded in the Workbench.
- Use cooperative Stop to cancel the Emscripten loop, release resources, and destroy the iframe.
- Treat synchronous non-yielding user code as unsupported and warn users that it can freeze the shared WebView.
- Recover from a frozen WebView by terminating and relaunching the application; do not reintroduce a separate visible preview window solely for forced termination.

### User code reaches privileged desktop APIs

**Mitigation:**

- Use a sandboxed opaque or separate origin.
- Do not initialize Tauri bindings inside the preview.
- Scope Tauri capabilities to the trusted WebView.
- Keep privileged commands in the trusted top-level frame.
- Validate message source, protocol version, type, and schema.
- Apply a restrictive content security policy.
- Warn users that the MVP is defence in depth rather than a complete malicious-code sandbox.

### Runtime/reference mismatch

**Mitigation:**

- Generate references from the same pinned MonoGame and .NET runtime.
- Use a fixed reference whitelist.
- Add diagnostics for unsupported APIs.
- Prove the contract in the Release-packaged application with final trimming and interpreter settings.

### Dynamic-code trimming and AOT

**Mitigation:**

- Keep interpreter support enabled.
- Disable AOT-only execution for user assemblies.
- Disable trimming or root the complete supported runtime and MonoGame API surface.
- Load portable PDBs with assemblies.
- Run representative compatibility fixtures against every release package.

### Content profile incompatibility

**Mitigation:**

- Accept only the documented Web-profile subset.
- Validate the `.xnb` platform marker before preview startup.
- Ship known-good fixtures from the pinned MonoGame revision.
- Report unsupported effects, compression, streaming, and platform profiles clearly.

### WebGL and audio resource churn

**Mitigation:**

- Cancel loops and release resources before removing the iframe.
- Test at least twenty lifecycle cycles.
- Enforce stabilized RSS and cleanup thresholds.
- Replace blocking context-loss dialogs with Output events.

### MonoGame backend changes destabilize the product

**Mitigation:**

- Pin an exact submodule commit.
- Update deliberately.
- Run the complete product test suite before accepting submodule updates.
- Record compatibility changes.

### Product-specific code leaks into MonoGame

**Mitigation:**

- Require architectural justification for submodule changes.
- Keep editor, compiler, project, and preview orchestration in the parent repository.
- Prefer general-purpose MonoGame web-host APIs over playground-specific APIs.

### Contributors forget the submodule workflow

**Mitigation:**

- Provide bootstrap scripts.
- Add clear README instructions.
- Validate submodule state in CI.
- Add `docs/submodule-workflow.md`.

---

## 26. Recommended first implementation task

Create the standalone playground repository and complete the feasibility spike.

### Required steps

1. Initialize the new repository.
2. Add `infinitespace-studios/MonoGame` at `external/MonoGame`.
3. Pin a commit from `feature/openglnative` and preserve it on a protected ref.
4. Record the complete toolchain manifest.
5. Add bootstrap, native artifact, and validation scripts.
6. Package the existing MonoGame web example in Tauri using Release settings; repeat with Electron if Tauri fails a mandatory criterion.
7. Apply and test the proposed sandbox, CSP, shell-specific privilege/IPC controls, and protocol boundary.
8. Verify WebGL, input, audio activation, resizing, content, and offline operation.
9. Add a persistent Roslyn compiler runtime.
10. Compile multiple source files and compatibility fixtures.
11. Load the emitted DLL and portable PDB in a clean preview iframe.
12. Discover and run its `Game` subclass without disposing it when `Run()` returns.
13. Implement and verify WebGL `Game.Exit()` in the MonoGame submodule.
14. Verify correct user source mapping for runtime exceptions.
15. Mount nested Web-profile assets before runtime startup and reject incompatible content.
16. Stop the game by cancelling the loop, releasing audio and WebGL, and destroying the preview.
17. Verify cooperative Stop for yielding games and document that a synchronous non-yielding `Update` is unsupported and may require application relaunch.
18. Repeat the lifecycle at least twenty times and enforce the memory limits.
19. Verify representative MonoGame APIs survive Release trimming and interpreter settings.
20. Produce the single normative feasibility report required by section 20.

### Explicit instruction to the implementing agent

Do not spend significant time polishing the editor UI until this pipeline has been demonstrated:

```text
New standalone repository
    → MonoGame submodule initialized
    → pinned MonoGame WebGL build
    → C# source
    → Roslyn
    → managed DLL and portable PDB
    → validated binary protocol
    → sandboxed Release preview
    → Assembly.Load with portable PDB
    → Game subclass discovery
    → MonoGame Game.Run()
    → WebGL rendering
    → Web-profile content
    → Game.Exit/Stop cleanup
    → Run again with clean state
```

If MonoGame changes are required, commit them inside the MonoGame fork and then update the parent repository's submodule pointer. Do not leave the parent repository dependent on uncommitted submodule changes.

---

## 27. Definition of success

The product is successful when a person unfamiliar with .NET project tooling can download a desktop application under the release size limit, edit recognizable MonoGame C# code, press Run, and see the result within the startup and compilation budgets without installing additional development tools.

The product must remain independently maintainable, while using an exact, reproducible version of MonoGame through the `external/MonoGame` Git submodule.
