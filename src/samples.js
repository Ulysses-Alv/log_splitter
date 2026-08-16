/**
 * @file samples.js
 * Embedded realistic Unity sample logs for 1-click testing and demonstration.
 */

export const SAMPLE_LOGS = {
  standard: {
    name: 'session_gameplay_crash.txt',
    description: 'Realistic session with scene loading, NavMesh errors, and NullReferenceException cascade.',
    content: `Initialize engine version: 2022.3.12f1 (6a9e14a1f6a1)
[Subsystems] Discovering subsystems at path
GfxDevice: creating device client; threaded=1; driver=Vulkan
14:02:10.123 [SceneLoader] Loaded Scene: MainMenu
14:02:11.450 [UI] Initializing main menu canvas
14:02:15.890 [UI] Play button pressed, starting campaign
14:02:16.200 [SceneLoader] Loaded Scene: Level01_Forest
14:02:17.100 [PlayerSpawner] Spawning player at (12.4, 0.5, -4.2)
14:02:17.340 [EnemySpawner] Spawning 12 goblins and 2 orcs
14:02:18.512 [WARNING] <color=yellow>[DOTween]</color> NULL target in tween callback
14:02:19.001 [Audio] Background music track 04 started
14:02:22.450 [AI] NavMesh agent calculated route to waypoint B
14:02:23.110 "SetDestination" can only be called on an active agent that has been placed on a NavMesh.
14:02:23.112 Failed to create agent because it is not close enough to the NavMesh
14:02:24.005 [Player] Player taking damage from trap
14:02:25.800 [Combat] Executing ultimate ability
14:02:26.110 NullReferenceException: Object reference not set to an instance of an object.
  at Game.Combat.AbilitySystem.CastSpell (Game.Combat.SpellData spell, UnityEngine.Vector3 targetPos) [0x00042] in <48f98a21345>:0 
  at Game.Player.PlayerController.Update () [0x00120] in <48f98a21345>:0 
14:02:26.120 NullReferenceException: Object reference not set to an instance of an object.
  at Game.Combat.DamageEffect.Apply () [0x00010] in <48f98a21345>:0 
14:02:28.900 [Physics] Explosion force applied to barrels
14:02:29.100 Cannot throw a kinematic rigidbody without disabling isKinematic first.
14:02:35.000 [SceneLoader] Loaded Scene: Level01_BossArena
14:02:36.500 [Boss] Boss AI initialized
14:02:40.200 [WARNING] Tween startup failed: target transform was destroyed
14:02:45.000 [Session] Application quit requested
`,
  },
  warnings: {
    name: 'session_warnings_only.txt',
    description: 'Session with benign tween and UI missing/null target warnings.',
    content: `Initialize engine version: 2022.3.12f1
10:15:00.100 [SceneLoader] Loaded Scene: Splash
10:15:02.300 [SceneLoader] Loaded Scene: MainMenu
10:15:05.400 [WARNING] [UI] missing/null target reference on HoverButton
10:15:06.100 [WARNING] [DOTween] NULL target in fade sequence
10:15:12.000 [SceneLoader] Loaded Scene: OptionsMenu
10:15:15.500 [WARNING] Tween startup failed: duration cannot be negative
10:15:20.000 [Session] Saved user preferences
`,
  },
  clean: {
    name: 'session_clean_run.txt',
    description: 'Clean run with zero warnings and zero errors across 3 scenes.',
    content: `Initialize engine version: 2022.3.12f1
08:00:00.000 [SceneLoader] Loaded Scene: Bootstrapper
08:00:02.150 [ServiceLocator] Initialized 14 core services
08:00:03.000 [SceneLoader] Loaded Scene: MainMenu
08:00:10.500 [SaveManager] Loaded profile: PlayerOne
08:00:15.000 [SceneLoader] Loaded Scene: Level_Tutorial
08:00:25.000 [Tutorial] Step 1 completed: Move with WASD
08:00:35.000 [Tutorial] Step 2 completed: Jump over obstacle
08:00:50.000 [SceneLoader] Loaded Scene: Level_01
08:01:20.000 [GameSession] Victory reached in 30.0s
08:01:25.000 [Session] Application exiting cleanly
`,
  },
  rapidBursts: {
    name: 'session_rapid_nullref_bursts.txt',
    description: 'Session demonstrating rapid 60 FPS NullReferenceExceptions grouped into a single critical event.',
    content: `Initialize engine version: 2022.3.12f1
16:45:00.000 [SceneLoader] Loaded Scene: StressTest
16:45:01.000 [Spawner] Spawning 500 particle controllers
16:45:02.000 NullReferenceException: Object reference not set to an instance of an object
16:45:02.016 NullReferenceException: Object reference not set to an instance of an object
16:45:02.033 NullReferenceException: Object reference not set to an instance of an object
16:45:02.050 NullReferenceException: Object reference not set to an instance of an object
16:45:02.066 NullReferenceException: Object reference not set to an instance of an object
16:45:02.083 NullReferenceException: Object reference not set to an instance of an object
16:45:02.100 NullReferenceException: Object reference not set to an instance of an object
16:45:02.116 NullReferenceException: Object reference not set to an instance of an object
16:45:02.133 NullReferenceException: Object reference not set to an instance of an object
16:45:02.150 NullReferenceException: Object reference not set to an instance of an object
16:45:15.000 [SceneLoader] Loaded Scene: MainMenu
16:45:18.000 [Session] Clean shutdown
`,
  },
};
