'use strict';

let angular = require('angular');

module.exports = angular.module('spinnaker.serverGroup.configure.gce.configuration.service', [
  require('../../../account/account.service'),
  require('../../../securityGroups/securityGroup.read.service.js'),
  require('../../../caches/cacheInitializer.js'),
  require('../../../loadBalancers/loadBalancer.read.service.js'),
  require('../../image/image.reader.js'),
  require('../../instance/gceInstanceTypeService.js'),
])
  .factory('gceServerGroupConfigurationService', function(gceImageReader, accountService, securityGroupReader,
                                                          gceInstanceTypeService, cacheInitializer,
                                                          $q, loadBalancerReader, _) {


    function configureCommand(command) {
      command.image = command.viewState.imageId;
      return $q.all({
        regionsKeyedByAccount: accountService.getRegionsKeyedByAccount('gce'),
        securityGroups: securityGroupReader.getAllSecurityGroups(),
        loadBalancers: loadBalancerReader.listLoadBalancers('gce'),
        instanceTypes: gceInstanceTypeService.getAllTypesByRegion(),
        images: gceImageReader.findImages({provider: 'gce'}),
      }).then(function(loader) {
        loader.accounts = _.keys(loader.regionsKeyedByAccount);
        loader.filtered = {};
        command.backingData = loader;
        configureImages(command);
        attachEventHandlers(command);
      });
    }

    function configureInstanceTypes(command) {
      var result = { dirty: {} };
      if (command.region) {
        var filtered = gceInstanceTypeService.getAvailableTypesForRegions(command.backingData.instanceTypes, [command.region]);
        if (command.instanceType && filtered.indexOf(command.instanceType) === -1) {
          command.instanceType = null;
          result.dirty.instanceType = true;
        }
        command.backingData.filtered.instanceTypes = filtered;
      } else {
        command.backingData.filtered.instanceTypes = [];
      }
      return result;
    }

    function configureImages(command) {
      var result = { dirty: {} };
      // TODO(duftler): Dynamically populate this field with the correct set of images based on region/zone/project
      if (command.viewState.disableImageSelection) {
        return result;
      }
      if (command.credentials !== command.viewState.lastImageAccount) {
        command.viewState.lastImageAccount = command.credentials;
        var filtered = extractFilteredImageNames(command);
        command.backingData.filtered.imageNames = filtered;
        if (filtered.indexOf(command.image) === -1) {
          command.image = null;
          result.dirty.imageName = true;
        }
      }
      return result;
    }

    function configureZones(command) {
      command.backingData.filtered.zones =
        command.backingData.regionsKeyedByAccount[command.credentials].regions[command.region];
    }

    function configureLoadBalancerOptions(command) {
      var results = { dirty: {} };
      var current = command.loadBalancers;
      var newLoadBalancers = _(command.backingData.loadBalancers)
        .pluck('accounts')
        .flatten(true)
        .filter({name: command.credentials})
        .pluck('regions')
        .flatten(true)
        .filter({name: command.region})
        .pluck('loadBalancers')
        .flatten(true)
        .pluck('name')
        .unique()
        .valueOf();

      if (current && command.loadBalancers) {
        var matched = _.intersection(newLoadBalancers, command.loadBalancers);
        var removed = _.xor(matched, current);
        command.loadBalancers = matched;
        if (removed.length) {
          results.dirty.loadBalancers = removed;
        }
      }
      command.backingData.filtered.loadBalancers = newLoadBalancers;
      return results;
    }

    function extractFilteredImageNames(command) {
      return _(command.backingData.images)
        .filter({account: command.credentials})
        .pluck('imageName')
        .flatten(true)
        .unique()
        .valueOf();
    }

    function refreshLoadBalancers(command) {
      return cacheInitializer.refreshCache('loadBalancers').then(function() {
        return loadBalancerReader.listLoadBalancers('gce').then(function(loadBalancers) {
          command.backingData.loadBalancers = loadBalancers;
          configureLoadBalancerOptions(command);
        });
      });
    }

    function getSecurityGroups(command) {
      var newSecurityGroups = command.backingData.securityGroups[command.credentials] || { gce: {}};
      return _(newSecurityGroups.gce.global)
        .sortBy('name')
        .valueOf();
    }

    function configureSecurityGroupOptions(command) {
      var results = { dirty: {} };
      var currentOptions = command.backingData.filtered.securityGroups;
      var newSecurityGroups = getSecurityGroups(command);
      if (currentOptions && command.securityGroups) {
        // not initializing - we are actually changing groups
        var currentGroupNames = command.securityGroups.map(function(groupId) {
          var match = _(currentOptions).find({id: groupId});
          return match ? match.name : groupId;
        });

        var matchedGroups = command.securityGroups.map(function(groupId) {
          var securityGroup = _(currentOptions).find({id: groupId}) ||
              _(currentOptions).find({name: groupId});
          return securityGroup ? securityGroup.name : null;
        }).map(function(groupName) {
          return _(newSecurityGroups).find({name: groupName});
        }).filter(function(group) {
          return group;
        });

        var matchedGroupNames = _.pluck(matchedGroups, 'name');
        var removed = _.xor(currentGroupNames, matchedGroupNames);
        command.securityGroups = _.pluck(matchedGroups, 'id');
        if (removed.length) {
          results.dirty.securityGroups = removed;
        }
      }
      command.backingData.filtered.securityGroups = newSecurityGroups;

      var implicitSecurityGroups = _.filter(newSecurityGroups, function(securityGroup) {
        return _.isEmpty(securityGroup.targetTags);
      });
      var implicitSecurityGroupIds = _.pluck(implicitSecurityGroups, 'id');

      command.securityGroups = _.union(command.securityGroups, implicitSecurityGroupIds).sort();

      return results;
    }

    function refreshSecurityGroups(command, skipCommandReconfiguration) {
      return cacheInitializer.refreshCache('securityGroups').then(function() {
        return securityGroupReader.getAllSecurityGroups().then(function(securityGroups) {
          command.backingData.securityGroups = securityGroups;
          if (!skipCommandReconfiguration) {
            configureSecurityGroupOptions(command);
          }
        });
      });
    }

    function refreshInstanceTypes(command) {
      return cacheInitializer.refreshCache('instanceTypes').then(function() {
        return gceInstanceTypeService.getAllTypesByRegion().then(function(instanceTypes) {
          command.backingData.instanceTypes = instanceTypes;
          configureInstanceTypes(command);
        });
      });
    }

    function attachEventHandlers(command) {

      command.regionChanged = function regionChanged() {
        var result = { dirty: {} };
        var filteredData = command.backingData.filtered;
        if (command.region) {
          angular.extend(result.dirty, configureInstanceTypes(command).dirty);

          configureZones(command);

          angular.extend(result.dirty, configureLoadBalancerOptions(command).dirty);
          angular.extend(result.dirty, configureImages(command).dirty);
        } else {
          filteredData.zones = null;
        }

        command.viewState.dirty = command.viewState.dirty || {};
        angular.extend(command.viewState.dirty, result.dirty);

        return result;
      };

      command.credentialsChanged = function credentialsChanged() {
        var result = { dirty: {} };
        var backingData = command.backingData;
        if (command.credentials) {
          backingData.filtered.regions = Object.keys(backingData.regionsKeyedByAccount[command.credentials].regions);
          if (backingData.filtered.regions.indexOf(command.region) === -1) {
            command.region = null;
            result.dirty.region = true;
          } else {
            angular.extend(result.dirty, command.regionChanged().dirty);
          }
          // This will eventually move to something like 'networkChanged()'.
          angular.extend(result.dirty, configureSecurityGroupOptions(command).dirty);
        } else {
          command.region = null;
        }

        command.viewState.dirty = command.viewState.dirty || {};
        angular.extend(command.viewState.dirty, result.dirty);

        return result;
      };
    }

    return {
      configureCommand: configureCommand,
      configureInstanceTypes: configureInstanceTypes,
      configureImages: configureImages,
      configureZones: configureZones,
      configureLoadBalancerOptions: configureLoadBalancerOptions,
      refreshLoadBalancers: refreshLoadBalancers,
      refreshSecurityGroups: refreshSecurityGroups,
      refreshInstanceTypes: refreshInstanceTypes,
    };


  }).name;