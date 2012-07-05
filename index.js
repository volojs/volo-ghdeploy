
/*jslint node: true */
'use strict';

/**package
{
    "name": "volo-ghdeploy",
    "description": "A volo command for deploying to GitHub Pages",
    "keywords": [
        "volo"
    ],
    "version": "0.0.2",
    "homepage": "http://github.com/volojs/volo-ghdeploy",
    "author": "James Burke <jrburke@gmail.com> (http://github.com/jrburke)",
    "licenses": [
        {
            "type": "BSD",
            "url": "https://github.com/volojs/volo-ghdeploy/blob/master/LICENSE"
        },
        {
            "type": "MIT",
            "url": "https://github.com/volojs/volo-ghdeploy/blob/master/LICENSE"
        }
    ],
    "engines": {
        "node": ">=0.6.7"
    }
}
**/

var path = require('path'),
    fs = require('fs');

/**
 * Returns a volo command that is wired up to use the given
 * buildDir and pagesDir
 *
 * @param  {String} buildDir the directory that has the build contents that
 * will be deployed to github
 * @param  {Sting} pagesDir the directory to use to hold the actual code
 * deployed to github. This command will copy the contents from buildDir
 * to the pagesDir, and set up the gh-deploy branch in the pagesDir.
 *
 * @return {Object} The volo command.
 */
module.exports = function (buildDir, pagesDir) {

    //Return an object that conforms to the volo command API.
    return {
        summary: 'Deploys code in ' + buildDir + ' to GitHub Pages. Uses ' +
            pagesDir + ' to house the deployed code and git info for the ' +
            'gh-pages branch',

        run: function (d, v, namedArgs) {
            var spawnOptions = {
                    useConsole: !namedArgs.quiet
                },
                q = v.require('q'),
                github = v.require('./lib/github'),
                githubAuth = v.require('./lib/github/auth'),
                authInfo,
                repoName,
                hasGhPages;

            q.call(function () {
                //First check if there is already a repo
                if (!v.exists(buildDir)) {
                    throw new Error(buildDir + ' does not exist. If that ' +
                        'directory is generated by a build command, run that ' +
                        'command first, then retry.');
                }

                //If already have gh-pages dir, go to next step.
                if (v.exists(pagesDir)) {
                    return;
                }

                //Figure out if already in a github repo.
                return githubAuth.fetch({ v: v })
                    .then(function (info) {
                        authInfo = info;

                        //Suggest the current directory name as the repo name.
                        repoName = path.basename(process.cwd());

                        return v.prompt(authInfo.user +
                                        ', name of github repo [' +
                                        repoName + ']:');
                    })
                    .then(function (promptRepoName) {
                        var dfd = q.defer();

                        if (promptRepoName) {
                            repoName = promptRepoName;
                        }

                        //First check to see if it exists.
                        github('repos/' + authInfo.user + '/' + repoName)
                            .then(function (data) {
                                var sshUrl = data.ssh_url;

                                //Repo exists, see if there is a gh-pages repo
                                //already
                                github('repos/' + authInfo.user + '/' + repoName + '/branches')
                                    .then(function (data) {
                                        if (data && data.length) {
                                            hasGhPages = data.some(function (branch) {
                                                return branch.name === 'gh-pages';
                                            });
                                        }
                                        dfd.resolve(sshUrl);
                                    }, dfd.reject);
                            }, function (err) {
                                if (err.response.statusCode === 404) {
                                    github('user/repos', {
                                        method: 'POST',
                                        token: authInfo.token,
                                        content: {
                                            name: repoName
                                        }
                                    })
                                        .then(function (data) {
                                            dfd.resolve(data.ssh_url);
                                        }, function (err) {
                                            dfd.reject(err);
                                        });
                                } else {
                                    dfd.reject(err);
                                }
                            });
                        return dfd.promise;
                    })
                    .then(function (sshUrl) {
                        //Set up .git.
                        v.mkdir(pagesDir);

                        //Set up the gh-pages repo in the built area.
                        return v.withDir(pagesDir, function () {
                            if (hasGhPages) {
                                //Set up the git repo locally. Just commit a file
                                //to get the repo prepped and sent to GitHub.
                                return v.sequence([
                                    ['git', 'init'],
                                    ['git', 'remote', 'add', 'origin', sshUrl],
                                    //This step mandated by:
                                    //http://help.github.com/pages/#project_pages_manually
                                    ['git', 'symbolic-ref', 'HEAD', 'refs/heads/gh-pages'],
                                    [v,     'rm', '.git/index'],
                                    ['git', 'clean', '-fdx'],

                                    ['git', 'pull', 'origin', 'gh-pages']
                                ], spawnOptions);
                            } else {
                                //Set up the git repo locally. Just commit a file
                                //to get the repo prepped and sent to GitHub.
                                return v.sequence([
                                    ['git', 'init'],
                                    ['git', 'remote', 'add', 'origin', sshUrl],
                                    //This step mandated by:
                                    //http://help.github.com/pages/#project_pages_manually
                                    ['git', 'symbolic-ref', 'HEAD', 'refs/heads/gh-pages'],
                                    [v,     'rm', '.git/index'],
                                    ['git', 'clean', '-fdx'],

                                    [v,     'write', 'index.html', 'Setting up pages...'],
                                    ['git', 'add', 'index.html'],
                                    ['git', 'commit', '-m', 'Create branch.'],
                                    ['git', 'push', 'origin', 'gh-pages']
                                ], spawnOptions);
                            }
                        });
                    });
            })
                .then(function () {
                    var message = namedArgs.m;
                    if (!message) {
                        message = 'Deploy';
                    }

                    //Clean up www-ghpages first, but keep .git
                    if (v.exists(pagesDir)) {
                        fs.readdirSync(pagesDir).forEach(function (name) {
                            if (name !== '.git') {
                                v.rm(pagesDir + '/' + name);
                            }
                        });
                    }

                    //Copy the contents of www-built to www-ghpages
                    //Copy the directory for output.
                    v.copyDir(buildDir, pagesDir);

                    //Trigger update to origin.
                    return v.withDir(pagesDir, function () {
                        return v.sequence([
                            //Add any new files
                            ['git', 'add', '.'],
                            //Remove any files from git that are not on on disk
                            ['git', 'add', '-u'],
                            ['git', 'commit', '-m', message],
                            ['git', 'push', 'origin', 'gh-pages']
                        ], spawnOptions);
                    });
                })
                .then(function () {
                    if (repoName) {
                        return 'GitHub Pages is set up. Check http://' +
                                authInfo.user + '.github.com/' + repoName +
                                '/ in about 10-15 minutes.';
                    }
                })
                .then(d.resolve, d.reject);
        }
    };
};
