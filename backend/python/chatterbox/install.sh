#!/bin/bash
set -e

backend_dir=$(dirname $0)
if [ -d $backend_dir/common ]; then
    source $backend_dir/common/libbackend.sh
else
    source $backend_dir/../common/libbackend.sh
fi

# This is here because the Intel pip index is broken and returns 200 status codes for every package name, it just doesn't return any package links.
# This makes uv think that the package exists in the Intel pip index, and by default it stops looking at other pip indexes once it finds a match.
# We need uv to continue falling through to the pypi default index to find optimum[openvino] in the pypi index
# the --upgrade actually allows us to *downgrade* torch to the version provided in the Intel pip index
if [ "x${BUILD_PROFILE}" == "xintel" ]; then
    EXTRA_PIP_INSTALL_FLAGS+=" --upgrade --index-strategy=unsafe-first-match"
fi
EXTRA_PIP_INSTALL_FLAGS+=" --no-build-isolation"

if [ "x${BUILD_PROFILE}" == "xl4t12" ]; then
    USE_PIP=true
    # Anchor the unconstrained chatterbox-tts deps so pip does not backtrack
    # for hours against the slow jetson-ai-lab mirror. See constraints-l4t12.txt.
    EXTRA_PIP_INSTALL_FLAGS+=" -c ${backend_dir}/constraints-l4t12.txt"
fi


installRequirements

if [ "x${BUILD_PROFILE}" == "xl4t12" ]; then
    # installRequirements ends by calling runProtogen, whose unpinned
    # `pip install grpcio-tools` force-upgrades setuptools to >=81.
    # setuptools 81 removed pkg_resources, which chatterbox imports
    # (`from pkg_resources import resource_filename`) -> the backend fails
    # to load. The `setuptools<81` line in requirements-l4t12.txt cannot win
    # this: the base venv already ships 65.5.0 (<81) so that constraint is a
    # no-op, and runProtogen then bumps it afterwards. protoc codegen has
    # already run by this point, so re-pin setuptools below 81 as the final
    # step to keep pkg_resources in the venv.
    pip install 'setuptools<81'
fi
