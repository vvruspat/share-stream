<?php
// Installed by the administrator, never accepted from the deployment payload.
$image = getenv('SHARE_STREAM_IMAGE');
if (!preg_match('/^share-stream-call:[0-9][a-zA-Z0-9_.-]*$/D', $image)) {
    throw new Exception('Invalid Share Stream image');
}
$service = App\Models\Service::where('uuid', 'fdigjscz43ygrrmgnxiie5n7')->firstOrFail();
$team = App\Models\Team::findOrFail($service->server->team_id);
session(['currentTeam' => $team]);
$compose = Symfony\Component\Yaml\Yaml::parse($service->docker_compose_raw);
if (!isset($compose['services']['web'], $compose['services']['turn'])) {
    throw new Exception('Unexpected collaboration compose');
}
$compose['services']['web']['image'] = $image;
unset($compose['services']['web']['build']);
$raw = Symfony\Component\Yaml\Yaml::dump($compose, 10, 2);
parseDockerComposeYaml($raw);
validateDockerComposeForInjection($raw);
$service->docker_compose_raw = $raw;
$service->save();
$service->parse();
$service->saveComposeConfigs();
$service->isConfigurationChanged(save: true);
$workdir = escapeshellarg($service->workdir());
$project = escapeshellarg($service->uuid);
remote_process([
    "docker compose --project-directory $workdir --project-name $project up -d --no-deps --force-recreate --pull never web < /dev/null",
], $service->server, type_uuid: $service->uuid, callEventOnFinish: 'ServiceStartFinished', callEventData: $service->id, queue: deployment_queue());
echo "Share Stream web deployment queued in Coolify\n";
