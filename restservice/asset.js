/*
 *  Copyright (c) 2005-2014, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
 *
 *  WSO2 Inc. licenses this file to you under the Apache License,
 *  Version 2.0 (the "License"); you may not use this file except
 *  in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing,
 *  software distributed under the License is distributed on an
 *  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 *  KIND, either express or implied.  See the License for the
 *  specific language governing permissions and limitations
 *  under the License.
 *
 */
asset.manager = function(ctx) {
    var tenantAPI = require('/modules/tenant-api.js').api;
    var setCustomAssetAttributes = function (asset, userRegistry) {
        var wadlUrl = asset.attributes.interface_wadl;
        if (wadlUrl != null) {
            try {
                var resource = userRegistry.registry.get(wadlUrl);
                var wadlContent = getInterfaceTypeContent(resource);
                var ComparatorUtils = Packages.org.wso2.carbon.governance.comparator.utils.ComparatorUtils;
                var comparatorUtils = new ComparatorUtils();
                var mediaType = "application/wadl+xml";
                try {
                    wadlContent = comparatorUtils.prettyFormatText(wadlContent, mediaType);
                } catch (ex) {

                }
                asset.wadlContent = wadlContent;
            } catch (e) {
                asset.wadlContent = "";
            }
        }
        var swaggerUrl = asset.attributes.interface_swagger;
        if (swaggerUrl != null) {
            try {
                var resource = userRegistry.registry.get(swaggerUrl);
                var swaggerContent = getInterfaceTypeContent(resource);
                asset.swaggerContent = swaggerContent;
            } catch (e) {
                asset.swaggerContent = "";
            }
        }
    }; 

    var setDependencies = function(genericArtifact, asset ,userRegistry) {
        var dependencyArtifacts = genericArtifact.getDependencies();
        asset.dependencies = getAssociations(dependencyArtifacts, userRegistry);
    };

    var setDependents = function(genericArtifact, asset, userRegistry) {
        var dependentArtifacts = genericArtifact.getDependents();
        asset.dependents = getAssociations(dependentArtifacts, userRegistry);
    };

    var getRegistry = function(cSession) {
        var tenantDetails = tenantAPI.createTenantAwareAssetResources(cSession,{type:ctx.assetType});
        if((!tenantDetails)&&(!tenantDetails.am)) {
            log.error('The tenant-api was unable to create a registry instance by resolving tenant details');
            throw 'The tenant-api  was unable to create a registry instance by resolving tenant details';
        }
        return tenantDetails.am.registry;
    };

    var getInterfaceTypeContent = function (resource) {
        var ByteArrayInputStream = Packages.java.io.ByteArrayInputStream;
        var content = resource.getContent();
        var value = '' + new Stream(new ByteArrayInputStream(content));
        return value;
    };

    var getAssociations = function(genericArtifacts, userRegistry){
        //Array to store the association names.
        var associations = [];
        if (genericArtifacts != null) {
            for (var index in genericArtifacts) {
                var deps = {};
                var path = genericArtifacts[index].getPath();
                var resource = userRegistry.registry.get('/_system/governance' + path);
                var mediaType = resource.getMediaType();
                var name = genericArtifacts[index].getQName().getLocalPart();
                var govUtils = Packages.org.wso2.carbon.governance.api.util.GovernanceUtils;
                var keyName = govUtils.getArtifactConfigurationByMediaType(getRegistry(ctx.session).registry, mediaType).getKey();
                var subPaths = path.split('/');
                var associationName = name;
                var associationUUID = resource.getUUID();
                var associationVersion = genericArtifacts[index].getAttribute("overview_version");
                // This is only for wadls and swaggers which have correct storage path
                if(!associationVersion && (subPaths.length - 2)>-1){
                    associationVersion = subPaths[subPaths.length - 2]
                }
                deps.associationName = associationName;
                deps.associationType = keyName;
                deps.associationUUID = associationUUID;
                deps.associationPath = resource.getPath();
                deps.associationVersion = associationVersion;

                if(deps.associationType == "wadl") {
                    associations.push(deps);
                }
                if(deps.associationType == "swagger") {
                    associations.push(deps);
                }
            }
        }
        return associations;
    };

    return {
        search: function(query, paging) {
            var assets = this._super.search.call(this, query, paging);
            return assets;
        },
        get: function(id) {
            var asset = this._super.get.call(this, id);
            var userRegistry = getRegistry(ctx.session);
            try {
                setCustomAssetAttributes(asset, userRegistry);
            } catch (e){}

            //get the GenericArtifactManager
            var rawArtifact = this.am.manager.getGenericArtifact(id);
            try {
                setDependencies(rawArtifact, asset, userRegistry);
            } catch (e){}
            try {
                setDependents(rawArtifact, asset, userRegistry);
            } catch (e){

            }

            return asset;
        }
    };
};

asset.configure = function () {
    return {
        meta: {
            ui: {
                icon: 'fw fw-rest-service',
                iconColor: 'purple'
            },
            isDependencyShown: true,
            isDiffViewShown:false
        }
    }
};

asset.renderer = function(ctx){
    return {
        pageDecorators:{
            downloadPopulator:function(page){
                //Populate the links for downloading content RXTs
                if(page.meta.pageName === 'details'){
                    var config = require('/config/store.js').config();
                    var pluralType = 'wadls'; //Assume it is a WADl
                    var domain = require('carbon').server.tenantDomain({tenantId:ctx.tenantId});
                    page.assets.downloadMetaData = {}; 
                    page.assets.downloadMetaData.enabled = false;
                    var dependencies = page.assets.dependencies || [];
                    var downloadFile = dependencies.filter(function(item){
                        return ((item.associationType == 'wadl')||(item.associationType == 'swagger'));
                    })[0];
                    if(downloadFile){
                      var typeDetails = ctx.rxtManager.getRxtTypeDetails(downloadFile.associationType);
                      page.assets.downloadMetaData.enabled = true;  
                      page.assets.downloadMetaData.downloadFileType = typeDetails.singularLabel.toUpperCase();
                      pluralType = typeDetails.pluralLabel.toLowerCase();
                      page.assets.downloadMetaData.url = config.server.https+'/governance/'+pluralType+'/'+downloadFile.associationUUID+'/content?tenant='+domain;          
                      if(downloadFile.associationType == 'swagger'){
                        page.assets.downloadMetaData.swaggerUrl = '/pages/swagger?path='+downloadFile.associationPath;
                      }
                    }
                }
            },
            jsonFormatter: function(page) {
                if (page.meta.pageName === 'details') {
                    var contacts = page.assets.attributes.contacts_entry;
                    if (contacts) {
                        var contacts_entry = [];
                        if (contacts.constructor === Array) {
                            for (var index in contacts) {
                                var contact = contacts[index].split(':');
                                var contact_entry = {};
                                contact_entry.name = contact[0];
                                contact_entry.value = contact[1];
                                contacts_entry.push(contact_entry);
                            }
                        } else {
                            var contact = contacts.split(':');
                            var contact_entry = {};
                            contact_entry.name = contact[0];
                            contact_entry.value = contact[1];
                            contacts_entry.push(contact_entry);
                        }
                        page.assets.attributes.contacts_entry = contacts_entry;
                    }
                    var endpoints = page.assets.attributes.endpoints_entry;
                    if (endpoints) {
                        var endpoints_entry = [];
                        if (endpoints.constructor === Array) {
                            for (var index in endpoints) {
                                var splitIndex = endpoints[index].indexOf(':');
                                var endpoint = [endpoints[index].slice(0, splitIndex), endpoints[index].slice(splitIndex + 1)];
                                var endpoint_entry = {};
                                endpoint_entry.name = endpoint[0];
                                endpoint_entry.value = endpoint[1];
                                endpoints_entry.push(endpoint_entry);
                            }
                        } else {
                            var splitIndex = endpoints.indexOf(':');
                            var endpoint = [endpoints.slice(0, splitIndex), endpoints.slice(splitIndex + 1)];
                            var endpoint_entry = {};
                            endpoint_entry.name = endpoint[0];
                            endpoint_entry.value = endpoint[1];
                            endpoints_entry.push(endpoint_entry);
                        }
                        page.assets.attributes.endpoints_entry = endpoints_entry;
                    }
                }
            }
        }
    };
};
