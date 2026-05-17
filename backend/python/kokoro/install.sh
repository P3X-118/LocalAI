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

if [ "x${BUILD_PROFILE}" == "xl4t12" ]; then
    USE_PIP=true
fi

installRequirements

if [ "x${BUILD_PROFILE}" == "xl4t12" ]; then
    # installRequirements ends by calling runProtogen, whose unpinned
    # `pip install grpcio-tools` force-upgrades setuptools to >=81.
    # setuptools 81 removed pkg_resources, which kokoro deps (e.g. babel,
    # pulled transitively) import -> ImportError if hit. The
    # `setuptools<81` line in requirements-l4t12.txt cannot win this: the
    # base venv already ships 65.5.0 (<81) so that constraint is a no-op,
    # and runProtogen then bumps it afterwards. protoc codegen has already
    # run by this point, so re-pin setuptools below 81 as the final step.
    pip install 'setuptools<81'
fi
