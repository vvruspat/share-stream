<?php
// Run inside the existing Coolify container via artisan tinker. Uses the same
// service model/parser/deployment action as Coolify's UI, without enabling its API
// or creating a persistent credential. No unrelated resource is changed.
$server = App\Models\Server::where('name', 'localhost')->firstOrFail();
$team = App\Models\Team::findOrFail($server->team_id);
session(['currentTeam' => $team]);
$project = App\Models\Project::firstOrCreate(
    ['name' => 'Share Stream', 'team_id' => $team->id],
    ['description' => 'Private music collaboration: voice and screen, native music remains independent.']
);
$environment = $project->environments()->where('name', 'production')->firstOrFail();
$destination = $server->destinations()->first();
if (! $destination) { throw new Exception('No Coolify destination configured.'); }
$compose = file_get_contents('/tmp/share-stream-compose.yaml');
parseDockerComposeYaml($compose);
validateDockerComposeForInjection($compose);
$service = App\Models\Service::firstOrNew(['name' => 'Voice and screen', 'environment_id' => $environment->id]);
$service->description = 'HTTPS signaling + separate screen/voice WebRTC transports + private TURN fallback.';
$service->server_id = $server->id;
$service->destination_id = $destination->id;
$service->destination_type = $destination->getMorphClass();
$service->docker_compose_raw = $compose;
$service->save();
$service->parse(isNew: true);
$web = $service->applications()->where('name', 'web')->firstOrFail();
$web->fqdn = 'https://stream.whitesquirrel.digital:48101';
$web->save();
$service->parse();
App\Actions\Service\StartService::dispatch($service);
echo json_encode(['project_uuid' => $project->uuid, 'environment_uuid' => $environment->uuid, 'service_uuid' => $service->uuid, 'status' => 'deployment queued'], JSON_PRETTY_PRINT).PHP_EOL;
