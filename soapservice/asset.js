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
    //If extension is moved to another folder (tenant support), this path need to be changed
    //JIRA:https://wso2.org/jira/browse/STORE-613
    var configs = require("/extensions/assets/soapservice/config/properties.json");
    var tenantAPI = require('/modules/tenant-api.js').api;
    /**
     * The function augments the provided query to include published state information
     * @param  {[type]} query [description]
     * @return {[type]}       The provided query object
     */
    var buildPublishedQuery = function(query) {
        //Get all of the published assets
        var publishedStates = ctx.rxtManager.getPublishedStates(ctx.assetType) || [];
        //Determine if there are any published states
        if (publishedStates.length == 0) {
            return query;
        }
        //If there is no query then build a new one
        if (!query) {
            query = {};
        }
        //TODO: Even though an array is sent in only the first search value is accepted
        query.lcState = [publishedStates[0]];
        return query;
    };
    var getRegistry = function(cSession) {
        var tenantDetails = tenantAPI.createTenantAwareAssetResources(cSession, {
            type: ctx.assetType
        });
        if ((!tenantDetails) && (!tenantDetails.am)) {
            log.error('The tenant-api was unable to create a registry instance by resolving tenant details');
            throw 'The tenant-api  was unable to create a registry instance by resolving tenant details';
        }
        return tenantDetails.am.registry;
    };
    var setCustomAssetAttributes = function(asset, userRegistry) {
        var interfaceUrl = asset.attributes.interface_wsdlURL;
        if (interfaceUrl != null) {
            try {
                var resource = userRegistry.registry.get(interfaceUrl);
                var wsdlContent = getInterfaceTypeContent(resource);
                asset.wsdlContent = wsdlContent;
                var wsdlUUID = getInterfaceTypeUUID(resource);
                asset.wsdl_uuid = wsdlUUID;
            } catch (e) {
                asset.wsdl_uuid = "";
                asset.wsdlContent = "";
            }
        }
    };
    var getInterfaceTypeContent = function(resource) {
        var ByteArrayInputStream = Packages.java.io.ByteArrayInputStream;
        var content = resource.getContent();
        var value = '' + new Stream(new ByteArrayInputStream(content));
        //this is wsdlcontent.
        return value;
    };
    var getInterfaceTypeUUID = function(resource) {
        var wsdlUUID = resource.getUUID();
        return wsdlUUID;
    };
    var getAssociations = function(genericArtifacts, userRegistry) {
        //Array to store the association names.
        var associations = [];
        if (genericArtifacts != null) {
            for (var index in genericArtifacts) {
                var deps = {};
                //extract the association name via the path.
                var path = genericArtifacts[index].getPath();
                var subPaths = path.split('/');
                var associationTypePlural = subPaths[2];
                var associationName = subPaths[subPaths.length - 1];
                var resource = userRegistry.registry.get(configs.depends_asset_path_prefix + path);
                var associationUUID = resource.getUUID();
                var associationVersion = genericArtifacts[index].getAttribute("overview_version");
                if (!associationVersion && (subPaths.length - 2) > -1) {
                    associationVersion = subPaths[subPaths.length - 2]
                }
                deps.associationName = associationName;
                deps.associationType = associationTypePlural.substring(0, associationTypePlural.lastIndexOf('s'));
                deps.associationUUID = associationUUID;
                deps.associationVersion = associationVersion;
                if (deps.associationType == "wsdl") {
                    associations.push(deps);
                }
            }
        }
        return associations;
    };
    var setDependencies = function(genericArtifact, asset, userRegistry) {
        //get dependencies of the artifact.
        var dependencyArtifacts = genericArtifact.getDependencies();
        asset.dependencies = getAssociations(dependencyArtifacts, userRegistry);
    };
    var setDependents = function(genericArtifact, asset, userRegistry) {
        var dependentArtifacts = genericArtifact.getDependents();
        asset.dependents = getAssociations(dependentArtifacts, userRegistry);
    };
    return {
        //due to a bug needed to replicate the 'search' method. JIRA:https://wso2.org/jira/browse/STORE-561
        search: function(query, paging) {
            //query = buildPublishedQuery(query);--commented this inorder to let anystate
            //to be visible in store.
            var assets = this._super.search.call(this, query, paging);
            return assets;
        },
        get: function(id) {
            //TODO: support services added through WSDL, once multiple lifecycle is supported.
            var asset = this._super.get.call(this, id);
            var userRegistry = getRegistry(ctx.session);
            try {
                setCustomAssetAttributes(asset, userRegistry);
            } catch (e) {}
            //get the GenericArtifactManager
            var rawArtifact = this.am.manager.getGenericArtifact(id);
            try {
                setDependencies(rawArtifact, asset, userRegistry);
            } catch (e) {}
            try {
                setDependents(rawArtifact, asset, userRegistry);
            } catch (e) {}
            return asset;
        }
    };
};
asset.configure = function() {
    return {
        meta: {
            ui: {
                icon: 'fw fw-soap',
                iconColor: 'orange'
            },
            isDependencyShown: true,
            isDiffViewShown: false
        }
    }
};
asset.renderer = function(ctx) {
    return {
        pageDecorators: {
            downloadPopulator: function(page) {
                //Populate the links for downloading content RXTs
                if (page.meta.pageName === 'details') {
                    var config = require('/config/store.js').config();
                    var pluralType = 'wsdls';
                    var domain = require('carbon').server.tenantDomain({
                        tenantId: ctx.tenantId
                    });
                    page.assets.downloadMetaData = {};
                    if (page.assets.wsdlContent) {
                        page.assets.downloadMetaData.enabled = true;
                        page.assets.downloadMetaData.downloadFileType = 'WSDL';
                        page.assets.downloadMetaData.url = config.server.https + '/governance/' + pluralType + '/' + page.assets.wsdl_uuid + '/content?tenant=' + domain;
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